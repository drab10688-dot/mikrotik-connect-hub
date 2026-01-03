import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Function to send Telegram notification
async function sendTelegramNotification(
  supabase: any,
  mikrotikId: string,
  chatId: string,
  clientName: string,
  invoiceNumber: string,
  amount: number,
  dueDate: string,
  clientId: string,
  invoiceId: string,
  createdBy: string
) {
  try {
    // Get Telegram config for this mikrotik
    const { data: telegramConfig } = await supabase
      .from('telegram_config')
      .select('bot_token, is_active')
      .eq('mikrotik_id', mikrotikId)
      .eq('is_active', true)
      .single();

    if (!telegramConfig) {
      console.log(`No active Telegram config for mikrotik ${mikrotikId}`);
      return { success: false, reason: 'No Telegram config' };
    }

    const message = `📄 *Nueva Factura Generada*

👤 Cliente: ${clientName}
📋 Factura: ${invoiceNumber}
💰 Monto: $${amount.toFixed(2)}
📅 Vencimiento: ${dueDate}

Por favor realice su pago antes de la fecha de vencimiento para evitar suspensión del servicio.

¡Gracias por su preferencia!`;

    const telegramUrl = `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();

    // Log the message
    await supabase.from('telegram_messages').insert({
      mikrotik_id: mikrotikId,
      chat_id: chatId,
      message_content: message,
      message_type: 'invoice',
      status: result.ok ? 'sent' : 'failed',
      sent_at: result.ok ? new Date().toISOString() : null,
      telegram_message_id: result.result?.message_id?.toString() || null,
      error_message: result.ok ? null : result.description,
      client_id: clientId,
      related_invoice_id: invoiceId,
      created_by: createdBy
    });

    console.log(`Telegram notification ${result.ok ? 'sent' : 'failed'} for ${clientName}`);
    return { success: result.ok, messageId: result.result?.message_id };
  } catch (error: unknown) {
    console.error('Error sending Telegram notification:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMsg };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('=== Starting daily invoice generation ===');
  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    console.log(`Checking for clients with billing day: ${currentDay}`);

    // Find all billing settings where today is the billing day
    const { data: billingSettings, error: billingError } = await supabase
      .from('client_billing_settings')
      .select(`
        id,
        client_id,
        mikrotik_id,
        billing_day,
        grace_period_days,
        monthly_amount,
        is_suspended,
        next_billing_date
      `)
      .eq('billing_day', currentDay)
      .eq('is_suspended', false);

    if (billingError) {
      console.error('Error fetching billing settings:', billingError);
      throw new Error('Error al obtener configuraciones de facturación');
    }

    console.log(`Found ${billingSettings?.length || 0} clients with billing day today`);

    const results = {
      total_clients: billingSettings?.length || 0,
      invoices_created: 0,
      already_billed: 0,
      telegram_sent: 0,
      errors: [] as string[],
      created_invoices: [] as string[]
    };

    for (const billing of billingSettings || []) {
      if (!billing.client_id) {
        console.log(`Billing setting ${billing.id} has no client_id, skipping`);
        continue;
      }

      // Check if invoice already exists for this month
      const billingPeriodStart = new Date(currentYear, currentMonth, 1);
      const billingPeriodEnd = new Date(currentYear, currentMonth + 1, 0);

      const { data: existingInvoice } = await supabase
        .from('client_invoices')
        .select('id')
        .eq('client_id', billing.client_id)
        .gte('billing_period_start', billingPeriodStart.toISOString().split('T')[0])
        .lte('billing_period_end', billingPeriodEnd.toISOString().split('T')[0])
        .single();

      if (existingInvoice) {
        console.log(`Invoice already exists for client ${billing.client_id} this month`);
        results.already_billed++;
        continue;
      }

      // Get client info including telegram_chat_id
      const { data: client, error: clientError } = await supabase
        .from('isp_clients')
        .select('id, client_name, username, email, telegram_chat_id')
        .eq('id', billing.client_id)
        .single();

      if (clientError || !client) {
        const errorMsg = `Client not found for billing ${billing.id}`;
        console.error(errorMsg);
        results.errors.push(errorMsg);
        continue;
      }

      // Generate invoice number
      const invoiceNumber = `INV-${currentYear}${String(currentMonth + 1).padStart(2, '0')}-${billing.client_id.slice(0, 8).toUpperCase()}`;

      // Calculate due date (billing day + grace period)
      const dueDate = new Date(currentYear, currentMonth, billing.billing_day + billing.grace_period_days);

      try {
        // Create invoice
        const { data: invoice, error: invoiceError } = await supabase
          .from('client_invoices')
          .insert({
            mikrotik_id: billing.mikrotik_id,
            client_id: billing.client_id,
            invoice_number: invoiceNumber,
            amount: billing.monthly_amount,
            billing_period_start: billingPeriodStart.toISOString().split('T')[0],
            billing_period_end: billingPeriodEnd.toISOString().split('T')[0],
            due_date: dueDate.toISOString().split('T')[0],
            status: 'pending'
          })
          .select()
          .single();

        if (invoiceError) {
          console.error(`Error creating invoice for client ${client.client_name}:`, invoiceError);
          results.errors.push(`Error creating invoice for ${client.client_name}: ${invoiceError.message}`);
          continue;
        }

        // Update next billing date
        const nextBillingDate = new Date(currentYear, currentMonth + 1, billing.billing_day);
        await supabase
          .from('client_billing_settings')
          .update({ next_billing_date: nextBillingDate.toISOString().split('T')[0] })
          .eq('id', billing.id);

        results.invoices_created++;
        results.created_invoices.push(`${invoiceNumber} - ${client.client_name}`);
        console.log(`Created invoice ${invoiceNumber} for ${client.client_name}`);

        // Send Telegram notification if client has chat_id
        if (client.telegram_chat_id && invoice) {
          const telegramResult = await sendTelegramNotification(
            supabase,
            billing.mikrotik_id,
            client.telegram_chat_id,
            client.client_name,
            invoiceNumber,
            billing.monthly_amount,
            dueDate.toISOString().split('T')[0],
            client.id,
            invoice.id,
            'system' // created_by for automatic invoices
          );
          if (telegramResult.success) {
            results.telegram_sent++;
          }
        }

      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing client ${client.client_name}:`, errorMsg);
        results.errors.push(`Error with ${client.client_name}: ${errorMsg}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== Completed invoice generation in ${duration}ms ===`);
    console.log(`Results: ${results.invoices_created} created, ${results.already_billed} already billed, ${results.errors.length} errors`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Invoice generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
