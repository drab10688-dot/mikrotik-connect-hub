import { Pool } from 'pg';

/**
 * Recolección de señal óptica directamente desde GenieACS (ACS-driven).
 * No requiere registro local de ONU ni MikroTik seleccionado:
 * todas las ONUs que informan al ACS entran automáticamente al historial.
 */

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs-nbi:7557';

const PROJECTION = [
  '_id',
  '_deviceId',
  '_lastInform',
  'InternetGatewayDevice.WANDevice',
  'InternetGatewayDevice.DeviceInfo',
  'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig',
  'InternetGatewayDevice.X_HW_PONInfo',
  'Device.Optical',
  'Device.DeviceInfo',
].join(',');

export async function ensureAcsSignalTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onu_aliases (
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acs_signal_history (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      serial TEXT,
      manufacturer TEXT,
      model TEXT,
      rx_power NUMERIC(6,2),
      tx_power NUMERIC(6,2),
      quality TEXT,
      temperature NUMERIC(6,2),
      wan_status TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acs_signal_history_device ON acs_signal_history(device_id, recorded_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acs_signal_config (
      id INT PRIMARY KEY DEFAULT 1,
      alerts_enabled BOOLEAN NOT NULL DEFAULT false,
      default_threshold NUMERIC(6,2) NOT NULL DEFAULT -28,
      default_chat_id TEXT,
      cooldown_minutes INT NOT NULL DEFAULT 60,
      auto_cleanup_days INT NOT NULL DEFAULT 90,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT acs_signal_config_single CHECK (id = 1)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acs_signal_alerts (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      serial TEXT,
      rx_power NUMERIC(6,2),
      threshold NUMERIC(6,2),
      message TEXT,
      sent_successfully BOOLEAN NOT NULL DEFAULT false,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acs_signal_alerts_created ON acs_signal_alerts(created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acs_signal_alert_state (
      device_id TEXT PRIMARY KEY,
      last_alert_sent_at TIMESTAMPTZ
    )
  `);
}

async function genieFetch(path: string) {
  const res = await fetch(`${GENIEACS_NBI}${path}`, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`GenieACS error (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function getParam(device: any, path: string): any {
  const parts = path.split('.');
  let current = device;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current?._value ?? (typeof current === 'object' ? undefined : current);
}

function normalizePower(val: any): number | null {
  const num = typeof val === 'number' ? val : (val != null && val !== '' ? parseFloat(String(val)) : NaN);
  if (!Number.isFinite(num)) return null;
  if (num > 100) return parseFloat((10 * Math.log10(num / 10000)).toFixed(2));
  return parseFloat(num.toFixed(2));
}

export function signalQuality(rx: number | null): string {
  if (rx === null) return 'unknown';
  if (rx > -20) return 'excellent';
  if (rx > -25) return 'good';
  if (rx > -28) return 'fair';
  return 'critical';
}

export function extractRx(device: any): number | null {
  return normalizePower(
    getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.RXPower')
    ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
    ?? getParam(device, 'Device.Optical.Interface.1.RxPower')
    ?? null
  );
}

export function extractTx(device: any): number | null {
  return normalizePower(
    getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower')
    ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.TXPower')
    ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
    ?? getParam(device, 'Device.Optical.Interface.1.TxPower')
    ?? null
  );
}

export function deviceMeta(device: any) {
  const igd = device?.InternetGatewayDevice || device?.Device || {};
  const di = igd?.DeviceInfo || {};
  const idParts = String(device?._id || '').split('-');
  const metadata = device?._deviceId || {};
  return {
    manufacturer: di?.Manufacturer?._value || metadata?._Manufacturer || idParts[0] || 'Desconocido',
    model: di?.ModelName?._value || di?.ProductClass?._value || metadata?._ProductClass || idParts[1] || '-',
    serial: di?.SerialNumber?._value || metadata?._SerialNumber || (idParts.length >= 3 ? idParts.slice(2).join('-') : '-'),
  };
}

async function sendTelegram(pool: Pool, chatId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { rows } = await pool.query(
      'SELECT bot_token FROM telegram_config WHERE is_active = true LIMIT 1'
    );
    if (!rows[0]) return { ok: false, error: 'Telegram no configurado' };
    const resp = await fetch(`https://api.telegram.org/bot${rows[0].bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    const result: any = await resp.json();
    return { ok: !!result?.ok, error: result?.ok ? undefined : result?.description };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export interface CollectResult {
  total: number;
  collected: number;
  alertsSent: number;
  errors: string[];
}

/** Recolecta y almacena la señal de TODAS las ONUs conectadas al ACS. */
export async function collectAcsSignals(pool: Pool): Promise<CollectResult> {
  await ensureAcsSignalTables(pool);

  const devices: any[] = (await genieFetch(`/devices/?projection=${encodeURIComponent(PROJECTION)}`)) || [];
  const { rows: cfgRows } = await pool.query('SELECT * FROM acs_signal_config WHERE id = 1');
  const cfg = cfgRows[0] || null;

  // Nombres: alias manual (si existe la tabla)
  let aliases: Record<string, string> = {};
  try {
    const { rows } = await pool.query('SELECT device_id, name FROM onu_aliases');
    rows.forEach((r: any) => { aliases[r.device_id] = r.name; });
  } catch { /* tabla aún no creada */ }

  const result: CollectResult = { total: devices.length, collected: 0, alertsSent: 0, errors: [] };

  for (const device of devices) {
    try {
      const rx = extractRx(device);
      const tx = extractTx(device);
      if (rx === null && tx === null) continue;

      const meta = deviceMeta(device);
      const igd = device?.InternetGatewayDevice || device?.Device || {};
      const temperature = normalizePower(
        getParam(device, 'InternetGatewayDevice.DeviceInfo.X_Temperature')
        ?? getParam(device, 'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value')
        ?? null
      );
      const wan = igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']
        || igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1'] || {};
      const wanStatus = wan?.ConnectionStatus?._value || wan?.Status?._value || null;

      await pool.query(
        `INSERT INTO acs_signal_history (device_id, serial, manufacturer, model, rx_power, tx_power, quality, temperature, wan_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [device._id, meta.serial, meta.manufacturer, meta.model, rx, tx, signalQuality(rx), temperature, wanStatus]
      );
      result.collected++;

      // Alertas Telegram (config global única)
      if (cfg?.alerts_enabled && cfg?.default_chat_id && rx !== null && rx < parseFloat(cfg.default_threshold)) {
        const { rows: stateRows } = await pool.query(
          'SELECT last_alert_sent_at FROM acs_signal_alert_state WHERE device_id = $1',
          [device._id]
        );
        const last = stateRows[0]?.last_alert_sent_at ? new Date(stateRows[0].last_alert_sent_at) : null;
        const cooldownAgo = new Date(Date.now() - (cfg.cooldown_minutes || 60) * 60 * 1000);

        if (!last || last < cooldownAgo) {
          const name = aliases[device._id] || meta.serial;
          const message = `🔴 <b>ALERTA: Señal Óptica Baja</b>\n\n` +
            `📡 <b>ONU:</b> ${name}\n` +
            `🏷️ <b>Equipo:</b> ${meta.manufacturer} ${meta.model}\n` +
            `📉 <b>Rx:</b> ${rx} dBm (umbral ${cfg.default_threshold} dBm)\n` +
            `${tx !== null ? `📤 <b>Tx:</b> ${tx} dBm\n` : ''}` +
            `\n⏰ ${new Date().toLocaleString('es')}\n🤖 <i>Monitoreo automático ACS</i>`;

          const sent = await sendTelegram(pool, cfg.default_chat_id, message);
          await pool.query(
            `INSERT INTO acs_signal_alerts (device_id, serial, rx_power, threshold, message, sent_successfully, error_message)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [device._id, meta.serial, rx, cfg.default_threshold, message, sent.ok, sent.error || null]
          );
          await pool.query(
            `INSERT INTO acs_signal_alert_state (device_id, last_alert_sent_at) VALUES ($1, now())
             ON CONFLICT (device_id) DO UPDATE SET last_alert_sent_at = now()`,
            [device._id]
          );
          if (sent.ok) result.alertsSent++;
        }
      }
    } catch (err: any) {
      result.errors.push(`${device?._id || '?'}: ${err.message}`);
    }
  }

  return result;
}

/** Limpieza automática del historial ACS. */
export async function cleanupAcsSignals(pool: Pool): Promise<number> {
  await ensureAcsSignalTables(pool);
  const { rows } = await pool.query('SELECT auto_cleanup_days FROM acs_signal_config WHERE id = 1');
  const days = rows[0]?.auto_cleanup_days || 90;
  const res = await pool.query(
    `DELETE FROM acs_signal_history WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`,
    [days]
  );
  await pool.query(`DELETE FROM acs_signal_alerts WHERE created_at < NOW() - INTERVAL '180 days'`);
  return res.rowCount || 0;
}
