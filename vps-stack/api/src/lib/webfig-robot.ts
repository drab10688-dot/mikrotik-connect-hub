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

/** Método de escritura que funcionó: 'insert' (atómico) o el retardo entre teclas en ms. */
export type WebfigMethod = 'insert' | 'echo' | number;

export interface WebfigResult { shot?: string; method?: WebfigMethod }

/**
 * Entra a WebFig y ejecuta `command` en su Terminal.
 * Lanza WebfigAuthError si la clave no entra. Devuelve una captura (JPEG
 * base64) del final, útil para revisar qué vio el robot, y el método de
 * escritura que funcionó (`method`) para reutilizarlo la próxima vez.
 * `preferred` permite probar primero el método que ya funcionó en esta antena.
 */
export async function runInWebfig(
  browser: Browser,
  opts: { ip: string; port: number; username: string; password: string; command: string; preferred?: WebfigMethod }
): Promise<WebfigResult> {
  const page = await browser.newPage();
  const shot = async () =>
    (await page.screenshot({ type: 'jpeg', quality: 45, encoding: 'base64' }).catch(() => undefined)) as string | undefined;
  try {
    // RouterOS 6.x antiguos: WebFig puede estar en la raíz y no en /webfig/
    let pass = null as any;
    for (const path of ['/webfig/', '/']) {
      try {
        await page.goto(`http://${opts.ip}:${opts.port}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        pass = await page.waitForSelector('input[type=password]', { visible: true, timeout: path === '/' ? 25_000 : 15_000 });
        if (pass) break;
      } catch { /* siguiente ruta */ }
    }
    if (!pass) throw new Error('No se encontró el formulario de inicio de sesión de WebFig');
    const user = (await page.$('#name')) || (await page.$('input[name=user]')) || (await page.$('input[type=text]'));
    if (!user) throw new Error('No se encontró el formulario de inicio de sesión de WebFig');

    // Usuario: se vacía lo que traiga (WebFig propone "admin") y se escribe
    await user.evaluate((el: any) => { el.value = ''; });
    await user.click();
    await user.type(opts.username, { delay: 20 });
    await pass.click();
    await pass.evaluate((el: any) => { el.value = ''; });
    await pass.type(opts.password, { delay: 20 });

    // Botón "Login" (si no se encuentra, Enter en el campo de clave).
    // Las funciones que corren dentro del navegador van como texto: la API no tiene tipos del DOM.
    const pressed = await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('input[type=button],input[type=submit],button,a'))
        .filter((e) => /^(log ?in|connect)$/i.test(((e.value || e.innerText || '') + '').trim()) && e.offsetParent !== null);
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
      })()`, { timeout: 25_000, polling: 500 })
      .then(() => 'ok')
      .catch(() => 'fail');
    if (state !== 'ok') {
      const text: string = await page.evaluate('document.body.innerText').catch(() => '') as string;
      throw /wrong|invalid|incorrect|denied|fail|error/i.test(text)
        ? new WebfigAuthError('WebFig rechazó el usuario o la clave')
        : new Error('No se pudo confirmar el inicio de sesión en WebFig (revisa la captura)');
    }
    // Antenas lentas (6.x) muestran "Loading ▮▮▮" un buen rato: esperar a que termine
    await page.waitForFunction(`!/^\\s*Loading/i.test(document.body.innerText || '')`, { timeout: 90_000, polling: 1000 })
      .catch(() => { throw new Error('WebFig se quedó en "Loading" (antena lenta o saturada)'); });
    await sleep(3000);

    // RouterOS 6.x abre la Terminal en una ventana emergente; v7 en la misma página
    const popupPromise = browser
      .waitForTarget((t) => t.opener() === page.target() && t.type() === 'page', { timeout: 8000 })
      .then((t) => t.page())
      .catch(() => null);

    // Botón/pestaña "Terminal" (el elemento más interno con ese texto exacto)
    const clicked = await page.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('a,button,span,div,td,li,input'))
        .filter((e) => ['Terminal', 'New Terminal'].includes(((e.value || e.innerText || '') + '').trim()) && e.offsetParent !== null);
      const el = els[els.length - 1];
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error('No se encontró el botón Terminal en WebFig');
    const popup = await popupPromise;
    const term = popup || page;
    if (popup) { await popup.setViewport({ width: 1000, height: 700 }).catch(() => undefined); await popup.bringToFront().catch(() => undefined); }
    await sleep(4000);

    // Texto de la terminal: incluye iframes (algunas 6.x la dibujan dentro de uno)
    const readScreen = async (): Promise<string> => {
      let txt = '';
      for (const f of term.frames()) txt += (await f.evaluate('document.body ? document.body.innerText : ""').catch(() => '')) as string;
      return txt;
    };

    // La terminal de WebFig manda cada tecla al router por separado: si se
    // escribe rápido, llegan desordenadas. Se escribe despacio y, ANTES de
    // pulsar Enter, se compara lo que muestra la pantalla con el comando; si no
    // coincide se borra la línea (Ctrl+C) y se reintenta más lento.
    const vp = term.viewport() || { width: 1280, height: 800 };
    await term.mouse.click(Math.round(vp.width / 2), Math.round(vp.height / 2));
    const flat = (s: string) => s.replace(/\s+/g, '');
    const want = flat(opts.command);
    const cancelLine = async () => {
      await term.keyboard.down('Control');
      await term.keyboard.press('KeyC');
      await term.keyboard.up('Control');
      await sleep(1500);
    };
    const currentLine = async (): Promise<string | null> => {
      const screen = flat(await readScreen());
      const at = screen.lastIndexOf(']>');
      return at < 0 ? null : screen.slice(at + 2);
    };
    const screenMatches = async (): Promise<boolean | null> => {
      const current = await currentLine();
      if (current === null) return null; // pantalla ilegible
      return current.startsWith(want) && current.length <= want.length + 2;
    };
    // Tecleo sincronizado con el eco: se manda UNA letra y no se manda la
    // siguiente hasta verla en pantalla. Así es imposible que lleguen
    // desordenadas, sin importar lo lenta que esté la antena o la VPN.
    const typeWithEcho = async (): Promise<boolean | null> => {
      const cmd = opts.command;
      for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i];
        await term.keyboard.type(ch);
        if (/\s/.test(ch)) { await sleep(250); continue; } // los espacios no se comparan
        const expected = flat(cmd.slice(0, i + 1));
        const deadline = Date.now() + 8000;
        let seen: string | null = null;
        while (Date.now() < deadline) {
          seen = await currentLine();
          if (seen === expected) break;
          // Ya apareció algo distinto a lo esperado: letra perdida o cambiada
          if (seen !== null && seen.length >= expected.length) return false;
          await sleep(120);
        }
        if (seen === null) return null;
        if (seen !== expected) return false; // la letra nunca llegó
        await sleep(40);
      }
      return true;
    };
    let usedMethod: WebfigMethod | null = null;
    // Métodos de escritura, en orden: primero el que ya funcionó en esta
    // antena (si se conoce), luego inserción atómica, tecleo con eco (2
    // intentos) y, si la pantalla no se puede leer, tecleo muy lento.
    const methods: WebfigMethod[] = ['insert', 'echo', 'echo', 500];
    if (opts.preferred !== undefined && methods.includes(opts.preferred)) {
      methods.splice(methods.indexOf(opts.preferred), 1);
      methods.unshift(opts.preferred);
    }
    for (const m of methods) {
      if (m === 'insert') {
        // Inserción atómica vía CDP: manda el comando completo de una vez
        try {
          const cdp = await term.target().createCDPSession();
          await cdp.send('Input.insertText', { text: opts.command });
          await sleep(2000);
        } catch { continue; /* sin CDP, siguiente método */ }
      } else if (m === 'echo') {
        const typed = await typeWithEcho();
        if (typed === false) { await cancelLine(); continue; }
        await sleep(800);
      } else {
        await term.keyboard.type(opts.command, { delay: m });
        await sleep(2000);
      }
      const ok = await screenMatches();
      if (ok === true) { usedMethod = m; break; }
      if (ok === false) await cancelLine();
      // ok === null: pantalla ilegible, se intenta el siguiente método sin pulsar Enter a ciegas
    }
    if (usedMethod === null) throw new Error('La terminal de WebFig no recibió el comando completo; no se ejecutó nada');
    await term.keyboard.press('Enter');
    await sleep(3000);
    const result: WebfigResult = { shot: (await term.screenshot({ type: 'jpeg', quality: 45, encoding: 'base64' }).catch(() => undefined)) as string | undefined, method: usedMethod };
    if (popup) await popup.close().catch(() => undefined);
    return result;
  } catch (e: any) {
    const s = await shot();
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { shot: s });
  } finally {
    await page.close().catch(() => undefined);
  }
}
