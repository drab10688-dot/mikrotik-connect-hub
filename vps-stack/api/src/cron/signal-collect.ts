import { Pool } from 'pg';

/**
 * Cron job: Recolecta señal óptica de todas las ONUs vinculadas al ACS
 * Se ejecuta cada 15 minutos para mantener el historial actualizado
 * y disparar alertas de Telegram cuando la señal baja del umbral.
 * 
 * Lógica de cascada:
 * 1. Si la ONU tiene configuración individual → usar esa
 * 2. Si no → usar la configuración global del MikroTik (onu_signal_config)
 * 3. Si no hay ninguna → no enviar alertas
 */
export async function runSignalCollectCron(pool: Pool) {
  console.log('[SIGNAL CRON] Starting optical signal collection...');

  try {
    const { rows: mikrotiks } = await pool.query(
      `SELECT DISTINCT mikrotik_id FROM onu_devices WHERE acs_device_id IS NOT NULL`
    );

    if (mikrotiks.length === 0) {
      console.log('[SIGNAL CRON] No MikroTik devices with ACS-linked ONUs found');
      return;
    }

    let totalErrors = 0;

    for (const { mikrotik_id } of mikrotiks) {
      try {
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

  // Load global config for this MikroTik
  const { rows: globalConfigs } = await pool.query(
    'SELECT * FROM onu_signal_config WHERE mikrotik_id = $1',
    [mikrotikId]
  );
  const globalConfig = globalConfigs[0] || null;

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

        // ── CASCADE ALERT LOGIC ──
        // Priority: individual ONU config > global MikroTik config
        const hasIndividualConfig = onu.signal_alerts_enabled !== null && onu.signal_alerts_enabled === true;
        
        let alertsEnabled = false;
        let threshold = -30;
        let chatId: string | null = null;
        let cooldownMinutes = 60;

        if (hasIndividualConfig) {
          // Use individual ONU config
          alertsEnabled = true;
          threshold = parseFloat(onu.signal_alert_threshold || '-30');
          chatId = onu.signal_alert_chat_id;
          cooldownMinutes = globalConfig?.cooldown_minutes || 60;
        } else if (globalConfig && globalConfig.alerts_enabled) {
          // Fallback to global config
          alertsEnabled = true;
          threshold = parseFloat(globalConfig.default_threshold || '-30');
          chatId = globalConfig.default_chat_id;
          cooldownMinutes = globalConfig.cooldown_minutes || 60;
        }

        if (alertsEnabled && rxPower !== null && rxPower < threshold) {
          const lastAlert = onu.last_alert_sent_at ? new Date(onu.last_alert_sent_at) : null;
          const cooldownAgo = new Date(Date.now() - cooldownMinutes * 60 * 1000);

          if (!lastAlert || lastAlert < cooldownAgo) {
            let clientName = 'Sin cliente';
            if (onu.client_id) {
              const cr = await pool.query('SELECT client_name FROM isp_clients WHERE id = $1', [onu.client_id]);
              if (cr.rows[0]) clientName = cr.rows[0].client_name;
            }

            const configSource = hasIndividualConfig ? 'Individual' : 'Global';
            const alertMessage = `🔴 <b>ALERTA: Señal Óptica Baja</b>\n\n` +
              `📡 <b>ONU:</b> ${onu.serial_number}\n` +
              `🏷️ <b>Marca:</b> ${onu.brand} ${onu.model || ''}\n` +
              `👤 <b>Cliente:</b> ${clientName}\n` +
              `📉 <b>Rx Power:</b> ${rxPower} dBm\n` +
              `⚠️ <b>Umbral:</b> ${threshold} dBm\n` +
              `${txPower !== null ? `📤 <b>Tx Power:</b> ${txPower} dBm\n` : ''}` +
              `${temperature !== null ? `🌡️ <b>Temperatura:</b> ${temperature}°C\n` : ''}` +
              `⚙️ <b>Config:</b> ${configSource}\n` +
              `\n⏰ ${new Date().toLocaleString('es')}\n🤖 <i>Recolección automática</i>`;

            if (chatId) {
              try {
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
                    `INSERT INTO onu_signal_alerts (onu_id, mikrotik_id, rx_power, threshold, message, sent_successfully, error_message)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [onu.id, mikrotikId, rxPower, threshold, alertMessage, sent, sent ? null : 'Telegram API error']
                  );

                  await pool.query(
                    'UPDATE onu_devices SET last_alert_sent_at = NOW() WHERE id = $1',
                    [onu.id]
                  );

                  console.log(`[SIGNAL CRON] Alert ${sent ? 'sent' : 'FAILED'} for ONU ${onu.serial_number} (${rxPower} dBm, config: ${configSource})`);
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

/**
 * Cron job: Limpieza automática del historial de señal óptica
 * Elimina registros antiguos según la configuración de cada MikroTik
 * (auto_cleanup_days en onu_signal_config, default 90 días)
 */
export async function runSignalCleanupCron(pool: Pool) {
  console.log('[SIGNAL CLEANUP] Starting old signal history cleanup...');

  try {
    // Get cleanup config per MikroTik
    const { rows: configs } = await pool.query(
      `SELECT mikrotik_id, auto_cleanup_days FROM onu_signal_config WHERE auto_cleanup_days > 0`
    );

    let totalDeleted = 0;

    // Clean configured MikroTiks with their specific retention
    for (const { mikrotik_id, auto_cleanup_days } of configs) {
      const result = await pool.query(
        `DELETE FROM onu_signal_history WHERE mikrotik_id = $1 AND recorded_at < NOW() - INTERVAL '1 day' * $2`,
        [mikrotik_id, auto_cleanup_days]
      );
      totalDeleted += result.rowCount || 0;
    }

    // Clean unconfigured MikroTiks with default 90 days
    const configuredIds = configs.map(c => c.mikrotik_id);
    if (configuredIds.length > 0) {
      const result = await pool.query(
        `DELETE FROM onu_signal_history WHERE mikrotik_id != ALL($1) AND recorded_at < NOW() - INTERVAL '90 days'`,
        [configuredIds]
      );
      totalDeleted += result.rowCount || 0;
    } else {
      const result = await pool.query(
        `DELETE FROM onu_signal_history WHERE recorded_at < NOW() - INTERVAL '90 days'`
      );
      totalDeleted += result.rowCount || 0;
    }

    // Also clean old signal alerts (keep 180 days)
    const alertResult = await pool.query(
      `DELETE FROM onu_signal_alerts WHERE created_at < NOW() - INTERVAL '180 days'`
    );
    const alertsDeleted = alertResult.rowCount || 0;

    console.log(`[SIGNAL CLEANUP] Done. History: ${totalDeleted} deleted, Alerts: ${alertsDeleted} deleted`);
  } catch (error) {
    console.error('[SIGNAL CLEANUP] Error:', error);
  }
}
