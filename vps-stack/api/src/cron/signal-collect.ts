import { Pool } from 'pg';

/**
 * Cron job: Recolecta señal óptica de todas las ONUs vinculadas al ACS
 * Se ejecuta cada 15 minutos para mantener el historial actualizado
 * y disparar alertas de Telegram cuando la señal baja del umbral.
 */
export async function runSignalCollectCron(pool: Pool) {
  console.log('[SIGNAL CRON] Starting optical signal collection...');

  try {
    // Get all mikrotik devices that have ONUs linked to ACS
    const { rows: mikrotiks } = await pool.query(
      `SELECT DISTINCT mikrotik_id FROM onu_devices WHERE acs_device_id IS NOT NULL`
    );

    if (mikrotiks.length === 0) {
      console.log('[SIGNAL CRON] No MikroTik devices with ACS-linked ONUs found');
      return;
    }

    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    let totalCollected = 0;
    let totalAlerts = 0;
    let totalErrors = 0;

    for (const { mikrotik_id } of mikrotiks) {
      try {
        // Call the existing signal-collect endpoint internally
        // We need to get a valid admin user for the auth header
        const { rows: adminUsers } = await pool.query(
          `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
        );

        if (adminUsers.length === 0) {
          console.warn('[SIGNAL CRON] No admin user found, skipping auth-dependent collection');
          // Perform collection directly without HTTP call
          await collectSignalsDirect(pool, mikrotik_id);
          continue;
        }

        await collectSignalsDirect(pool, mikrotik_id);
      } catch (error: any) {
        totalErrors++;
        console.error(`[SIGNAL CRON] Error collecting for MikroTik ${mikrotik_id}:`, error.message);
      }
    }

    console.log(`[SIGNAL CRON] Completed. Devices scanned: ${mikrotiks.length}, Errors: ${totalErrors}`);
  } catch (error) {
    console.error('[SIGNAL CRON] Fatal error:', error);
  }
}

// Direct signal collection (reuses the same logic as the API endpoint)
async function collectSignalsDirect(pool: Pool, mikrotikId: string) {
  const GENIEACS_NBI_URL = process.env.GENIEACS_NBI_URL || 'http://genieacs-nbi:7557';

  const genieFetch = async (path: string, options: any = {}) => {
    const resp = await fetch(`${GENIEACS_NBI_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!resp.ok) throw new Error(`GenieACS ${resp.status}`);
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  };

  const getParam = (device: any, path: string): any => {
    const parts = path.split('.');
    let current = device;
    for (const part of parts) {
      if (!current || typeof current !== 'object') return null;
      current = current[part];
    }
    return current?._value ?? current ?? null;
  };

  const normalizePower = (val: number | null): number | null => {
    if (val === null) return null;
    if (val > 100) return parseFloat((10 * Math.log10(val / 10000)).toFixed(2));
    return val;
  };

  const quality = (rx: number | null): string => {
    if (rx === null) return 'unknown';
    if (rx > -20) return 'excellent';
    if (rx > -25) return 'good';
    if (rx > -28) return 'fair';
    return 'critical';
  };

  // Get ONUs with ACS link
  const { rows: onus } = await pool.query(
    `SELECT id, acs_device_id, serial_number, brand, model, client_id,
            signal_alert_threshold, signal_alerts_enabled, signal_alert_chat_id, last_alert_sent_at
     FROM onu_devices WHERE mikrotik_id = $1 AND acs_device_id IS NOT NULL`,
    [mikrotikId]
  );

  let collected = 0;

  for (const onu of onus) {
    try {
      const device = await genieFetch(`/devices/${encodeURIComponent(onu.acs_device_id)}`);
      const igd = device?.InternetGatewayDevice || device?.Device || {};

      let rxPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
        ?? getParam(device, 'Device.Optical.Interface.1.RxPower')
        ?? null;

      let txPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
        ?? getParam(device, 'Device.Optical.Interface.1.TxPower')
        ?? null;

      rxPower = normalizePower(rxPower);
      txPower = normalizePower(txPower);

      const temperature = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_Temperature')
        ?? getParam(device, 'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value')
        ?? null;

      const cpuUsage = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_CPU_Usage')
        ?? getParam(device, 'Device.DeviceInfo.ProcessStatus.CPUUsage')
        ?? null;

      const wan = igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1'] ||
                  igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1'] || {};
      const wanStatus = wan?.ConnectionStatus?._value || wan?.Status?._value || null;

      if (rxPower !== null || txPower !== null) {
        await pool.query(
          `INSERT INTO onu_signal_history (onu_id, mikrotik_id, rx_power, tx_power, quality, temperature, cpu_usage, wan_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [onu.id, mikrotikId, rxPower, txPower, quality(rxPower), temperature, cpuUsage, wanStatus]
        );
        collected++;

        // Check alert threshold
        if (onu.signal_alerts_enabled && rxPower !== null && rxPower < parseFloat(onu.signal_alert_threshold)) {
          const lastAlert = onu.last_alert_sent_at ? new Date(onu.last_alert_sent_at) : null;
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

          if (!lastAlert || lastAlert < oneHourAgo) {
            let clientName = 'Sin cliente';
            if (onu.client_id) {
              const cr = await pool.query('SELECT client_name FROM isp_clients WHERE id = $1', [onu.client_id]);
              if (cr.rows[0]) clientName = cr.rows[0].client_name;
            }

            const alertMessage = `🔴 <b>ALERTA: Señal Óptica Baja</b>\n\n` +
              `📡 <b>ONU:</b> ${onu.serial_number}\n` +
              `🏷️ <b>Marca:</b> ${onu.brand} ${onu.model || ''}\n` +
              `👤 <b>Cliente:</b> ${clientName}\n` +
              `📉 <b>Rx Power:</b> ${rxPower} dBm\n` +
              `⚠️ <b>Umbral:</b> ${onu.signal_alert_threshold} dBm\n` +
              `${txPower !== null ? `📤 <b>Tx Power:</b> ${txPower} dBm\n` : ''}` +
              `${temperature !== null ? `🌡️ <b>Temperatura:</b> ${temperature}°C\n` : ''}` +
              `\n⏰ ${new Date().toLocaleString('es')}\n🤖 <i>Recolección automática</i>`;

            const chatId = onu.signal_alert_chat_id;
            if (chatId) {
              try {
                // Get telegram bot token
                const { rows: tg } = await pool.query(
                  'SELECT bot_token FROM telegram_config WHERE mikrotik_id = $1 AND is_active = true',
                  [mikrotikId]
                );
                if (tg[0]) {
                  const tgResp = await fetch(`https://api.telegram.org/bot${tg[0].bot_token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: alertMessage, parse_mode: 'HTML' }),
                  });
                  const sent = tgResp.ok;

                  await pool.query(
                    `INSERT INTO onu_signal_alerts (onu_id, mikrotik_id, rx_power, threshold, alert_message, sent_via, status)
                     VALUES ($1, $2, $3, $4, $5, 'telegram', $6)`,
                    [onu.id, mikrotikId, rxPower, onu.signal_alert_threshold, alertMessage, sent ? 'sent' : 'failed']
                  );

                  await pool.query(
                    'UPDATE onu_devices SET last_alert_sent_at = NOW() WHERE id = $1',
                    [onu.id]
                  );

                  console.log(`[SIGNAL CRON] Alert ${sent ? 'sent' : 'FAILED'} for ONU ${onu.serial_number} (${rxPower} dBm)`);
                }
              } catch (tgErr: any) {
                console.error(`[SIGNAL CRON] Telegram error for ${onu.serial_number}:`, tgErr.message);
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[SIGNAL CRON] Failed to read ONU ${onu.serial_number}:`, err.message);
    }
  }

  console.log(`[SIGNAL CRON] MikroTik ${mikrotikId}: ${collected}/${onus.length} ONUs collected`);
}
