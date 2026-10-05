import { execFile } from 'child_process';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * "Robot" de WebFig: un Chromium sin pantalla que entra a la web de una
 * antena MikroTik y escribe un comando en su Terminal, como lo haría una
 * persona. Sirve para activar la API en antenas que solo tienen WebFig/Winbox
 * (el cifrado de WebFig lo hace el propio WebFig dentro del navegador).
 *
 * El Chromium corre en un contenedor efímero que comparte la red de la API
 * (--network container:omnisync-api): usa las mismas rutas por túnel que la
 * API crea hacia cada antena, y su puerto de control solo existe en 127.0.0.1.
 */

const IMAGE = process.env.WEBFIG_ROBOT_IMAGE || 'zenika/alpine-chrome:latest';
const NAME = 'omnisync-webfig-robot';
const API_CONTAINER = process.env.API_CONTAINER || 'omnisync-api';
const CDP_URL = 'http://127.0.0.1:9222';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()));
      else resolve(String(stdout));
    });
  });
}

let browserPromise: Promise<Browser> | null = null;
let users = 0;
let stopTimer: NodeJS.Timeout | null = null;

async function startBrowser(): Promise<Browser> {
  await docker(['rm', '-f', NAME], 30_000).catch(() => undefined);
  const hasImage = await docker(['image', 'inspect', IMAGE], 15_000).then(() => true).catch(() => false);
  if (!hasImage) await docker(['pull', IMAGE], 600_000);
  await docker([
    'run', '-d', '--rm', '--name', NAME,
    '--network', `container:${API_CONTAINER}`,
    '--shm-size', '256m',
    '--memory', '768m',
    IMAGE,
    '--no-sandbox',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
    'about:blank',
  ]);
  for (let i = 0; i < 30; i++) {
    try {
      return await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: { width: 1280, height: 800 } });
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('El navegador automático no arrancó');
}

/** Presta el navegador mientras dura `fn`; se apaga 60 s después del último uso. */
export async function withRobot<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  users++;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  try {
    if (!browserPromise) browserPromise = startBrowser().catch((e) => { browserPromise = null; throw e; });
    return await fn(await browserPromise);
  } finally {
    users--;
    if (users === 0) {
      stopTimer = setTimeout(async () => {
        const b = browserPromise;
        browserPromise = null;
        await b?.then((x) => x.disconnect()).catch(() => undefined);
        await docker(['rm', '-f', NAME], 30_000).catch(() => undefined);
      }, 60_000);
    }
  }
}

export class WebfigAuthError extends Error {}

export interface WebfigResult { shot?: string }

/**
 * Entra a WebFig y ejecuta `command` en su Terminal.
 * Lanza WebfigAuthError si la clave no entra. Devuelve una captura (JPEG
 * base64) del final, útil para revisar qué vio el robot.
 */
export async function runInWebfig(
  browser: Browser,
  opts: { ip: string; port: number; username: string; password: string; command: string }
): Promise<WebfigResult> {
  const page = await browser.newPage();
  const shot = async () =>
    (await page.screenshot({ type: 'jpeg', quality: 45, encoding: 'base64' }).catch(() => undefined)) as string | undefined;
  try {
    await page.goto(`http://${opts.ip}:${opts.port}/webfig/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const pass = await page.waitForSelector('input[type=password]', { visible: true, timeout: 25_000 });
    const user = (await page.$('#name')) || (await page.$('input[type=text]'));
    if (!pass || !user) throw new Error('No se encontró el formulario de inicio de sesión de WebFig');

    // Usuario: se borra lo que traiga (WebFig propone "admin") y se escribe
    await user.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await user.type(opts.username, { delay: 20 });
    await pass.click();
    await pass.type(opts.password, { delay: 20 });

    // Botón "Login" (si no se encuentra, Enter en el campo de clave).
    // Las funciones que corren dentro del navegador van como texto: la API no tiene tipos del DOM.
    const pressed = await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('input[type=button],input[type=submit],button,a'))
        .filter((e) => /^log ?in$/i.test(((e.value || e.innerText || '') + '').trim()) && e.offsetParent !== null);
      if (!els.length) return false;
      els[0].click();
      return true;
    })()`);
    if (!pressed) await page.keyboard.press('Enter');

    // Sesión iniciada = el campo de clave ya no se ve (WebFig lo oculta, no lo
    // borra) o aparece "Logout". Clave incorrecta = el formulario sigue visible.
    const state = await page
      .waitForFunction(`(() => {
        const p = document.querySelector('input[type=password]');
        const hidden = !p || p.offsetParent === null || p.getBoundingClientRect().height === 0;
        return hidden || /\\blog ?out\\b/i.test(document.body.innerText) ? 'ok' : false;
      })()`, { timeout: 20_000, polling: 500 })
      .then(() => 'ok')
      .catch(() => 'fail');
    if (state !== 'ok') {
      const text: string = await page.evaluate('document.body.innerText').catch(() => '') as string;
      throw /wrong|invalid|incorrect|denied|fail|error/i.test(text)
        ? new WebfigAuthError('WebFig rechazó el usuario o la clave')
        : new Error('No se pudo confirmar el inicio de sesión en WebFig (revisa la captura)');
    }
    await sleep(2500);

    // Botón/pestaña "Terminal" (el elemento más interno con ese texto exacto)
    const clicked = await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('a,button,span,div,td,li'))
        .filter((e) => ['Terminal', 'New Terminal'].includes((e.innerText || '').trim()) && e.offsetParent !== null);
      const el = els[els.length - 1];
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error('No se encontró el botón Terminal en WebFig');
    await sleep(3000);

    // La terminal recibe el teclado de la página: se enfoca y se escribe
    await page.mouse.click(640, 450);
    await page.keyboard.type(opts.command, { delay: 20 });
    await page.keyboard.press('Enter');
    await sleep(3000);
    return { shot: await shot() };
  } catch (e: any) {
    const s = await shot();
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { shot: s });
  } finally {
    await page.close().catch(() => undefined);
  }
}
