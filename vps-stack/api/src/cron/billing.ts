import { Pool } from 'pg';
import { mikrotikRequest } from '../lib/mikrotik';

export async function runBillingCron(pool: Pool) {
  const today = new Date();
  const dayOfMonth = today.getDate();

  console.log(`[BILLING CRON] Running for day ${dayOfMonth}`);

  try {
    // 1. Generate invoices for clients with billing_type = 'due'
    await generateDueInvoices(pool, today, dayOfMonth);

    // 2. Check overdue invoices and suspend clients
    await checkOverdueInvoices(pool, today);

    console.log('[BILLING CRON] Completed successfully');
  } catch (error) {
    console.error('[BILLING CRON] Error:', error);
  }
}

async function generateDueInvoices(pool: Pool, today: Date, dayOfMonth: number) {
  const { rows: clients } = await pool.query(
    `SELECT c.id, c.client_name, c.username, c.mikrotik_id,
            bs.monthly_amount, bs.billing_day
     FROM isp_clients c
     JOIN client_billing_settings bs ON bs.client_id = c.id
     JOIN billing_config bc ON bc.mikrotik_id = c.mikrotik_id
     WHERE bs.billing_day = $1
       AND bc.billing_type = 'due'
       AND c.is_potential_client = false
       AND bs.is_suspended = false`,
    [dayOfMonth]
  );

  for (const client of clients) {
    const periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const { rows: existing } = await pool.query(
      `SELECT id FROM client_invoices
       WHERE client_id = $1 AND billing_period_start = $2`,
      [client.id, periodStart]
    );

    if (existing.length === 0) {
      const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const { rows: config } = await pool.query(
        'SELECT invoice_maturity_days FROM billing_config WHERE mikrotik_id = $1',
        [client.mikrotik_id]
      );
      const maturityDays = config[0]?.invoice_maturity_days || 15;
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + maturityDays);

      await pool.query(
        `INSERT INTO client_invoices (mikrotik_id, client_id, invoice_number, amount, due_date,
          billing_period_start, billing_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [client.mikrotik_id, client.id, invoiceNumber, client.monthly_amount,
         dueDate, periodStart, periodEnd]
      );

      console.log(`[BILLING] Invoice generated for ${client.client_name}: ${invoiceNumber}`);
    }
  }
}

async function checkOverdueInvoices(pool: Pool, today: Date) {
  // Find overdue invoices
  const { rows: overdue } = await pool.query(
    `SELECT i.id, i.client_id, i.mikrotik_id, c.assigned_ip, c.username,
            bc.suspension_address_list, bc.grace_period_days
     FROM client_invoices i
     JOIN isp_clients c ON c.id = i.client_id
     JOIN billing_config bc ON bc.mikrotik_id = i.mikrotik_id
     WHERE i.status = 'pending'
       AND i.due_date + (bc.grace_period_days || ' days')::interval < $1`,
    [today]
  );

  for (const invoice of overdue) {
    // Mark invoice as overdue
    await pool.query("UPDATE client_invoices SET status = 'overdue' WHERE id = $1", [invoice.id]);

    // Suspend client
    await pool.query(
      `UPDATE client_billing_settings SET is_suspended = true, suspended_at = now()
       WHERE client_id = $1`,
      [invoice.client_id]
    );

    // Add to MikroTik address list for suspension
    if (invoice.assigned_ip && invoice.suspension_address_list) {
      try {
        const { rows: device } = await pool.query(
          'SELECT host, port, username, password FROM mikrotik_devices WHERE id = $1',
          [invoice.mikrotik_id]
        );

        if (device[0]) {
          await mikrotikRequest(
            { ...device[0], useTls: device[0].port === 443 || device[0].port === 8729 },
            '/rest/ip/firewall/address-list/add',
            'POST',
            {
              list: invoice.suspension_address_list,
              address: invoice.assigned_ip,
              comment: `Suspended - ${invoice.username} - Invoice overdue`,
            }
          );
          console.log(`[BILLING] Suspended ${invoice.username} (${invoice.assigned_ip})`);
        }
      } catch (error) {
        console.error(`[BILLING] Error suspending ${invoice.username}:`, error);
      }
    }
  }
}
