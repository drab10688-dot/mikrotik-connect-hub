import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('=== Starting daily overdue invoices check ===');
  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split('T')[0];
    console.log(`Checking for overdue invoices as of: ${today}`);

    // Find all overdue invoices that are pending
    const { data: overdueInvoices, error: invoicesError } = await supabase
      .from('client_invoices')
      .select(`
        id,
        invoice_number,
        client_id,
        mikrotik_id,
        amount,
        due_date,
        status
      `)
      .eq('status', 'pending')
      .lt('due_date', today);

    if (invoicesError) {
      console.error('Error fetching overdue invoices:', invoicesError);
      throw new Error('Error al obtener facturas vencidas');
    }

    console.log(`Found ${overdueInvoices?.length || 0} overdue invoices`);

    const results = {
      total_overdue: overdueInvoices?.length || 0,
      suspended: 0,
      already_suspended: 0,
      errors: [] as string[],
      processed_clients: [] as string[]
    };

    // Process each overdue invoice
    for (const invoice of overdueInvoices || []) {
      if (!invoice.client_id) {
        console.log(`Invoice ${invoice.invoice_number} has no associated client, skipping`);
        continue;
      }

      // Get client info
      const { data: client, error: clientError } = await supabase
        .from('isp_clients')
        .select('id, client_name, username, assigned_ip, mikrotik_id')
        .eq('id', invoice.client_id)
        .single();
      
      if (clientError || !client) {
        console.log(`Invoice ${invoice.invoice_number} client not found, skipping`);
        continue;
      }

      console.log(`Processing client: ${client.client_name} (${client.username}) - Invoice: ${invoice.invoice_number}`);

      // Check if client is already suspended
      const { data: billingSettings } = await supabase
        .from('client_billing_settings')
        .select('is_suspended')
        .eq('client_id', client.id)
        .single();

      if (billingSettings?.is_suspended) {
        console.log(`Client ${client.client_name} is already suspended, skipping`);
        results.already_suspended++;
        continue;
      }

      // Get MikroTik device info
      const { data: device, error: deviceError } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', client.mikrotik_id)
        .single();

      if (deviceError || !device) {
        const errorMsg = `Device not found for client ${client.client_name}`;
        console.error(errorMsg);
        results.errors.push(errorMsg);
        continue;
      }

      // Add to morosos address list in MikroTik
      const ipAddress = client.assigned_ip;
      
      if (!ipAddress) {
        const errorMsg = `No IP assigned to client ${client.client_name}`;
        console.error(errorMsg);
        results.errors.push(errorMsg);
        continue;
      }

      try {
        console.log(`Adding ${ipAddress} to morosos list on ${device.name}`);
        
        const mikrotikResult = await addToAddressList(device, ipAddress, client.client_name);
        
        if (!mikrotikResult.success) {
          results.errors.push(`Failed to add ${client.client_name} to morosos: ${mikrotikResult.error}`);
          continue;
        }

        // Update or create billing settings
        const { data: existingSettings } = await supabase
          .from('client_billing_settings')
          .select('id')
          .eq('client_id', client.id)
          .single();

        if (existingSettings) {
          await supabase
            .from('client_billing_settings')
            .update({
              is_suspended: true,
              suspended_at: new Date().toISOString()
            })
            .eq('client_id', client.id);
        } else {
          await supabase
            .from('client_billing_settings')
            .insert({
              client_id: client.id,
              mikrotik_id: client.mikrotik_id,
              monthly_amount: invoice.amount,
              is_suspended: true,
              suspended_at: new Date().toISOString()
            });
        }

        // Update invoice status to overdue
        await supabase
          .from('client_invoices')
          .update({ status: 'overdue' })
          .eq('id', invoice.id);

        results.suspended++;
        results.processed_clients.push(client.client_name);
        console.log(`Successfully suspended client: ${client.client_name}`);

      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error suspending client ${client.client_name}:`, errorMsg);
        results.errors.push(`Error with ${client.client_name}: ${errorMsg}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== Completed overdue check in ${duration}ms ===`);
    console.log(`Results: ${results.suspended} suspended, ${results.already_suspended} already suspended, ${results.errors.length} errors`);

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
    console.error('Cron job error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to add IP to MikroTik address list
async function addToAddressList(device: any, ipAddress: string, clientName: string) {
  try {
    const baseUrl = `https://${device.host}:${device.port || 8729}`;
    
    // Using REST API (RouterOS 7+)
    const response = await fetch(`${baseUrl}/rest/ip/firewall/address-list`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${device.username}:${device.password}`)
      },
      body: JSON.stringify({
        list: 'morosos',
        address: ipAddress,
        comment: `Moroso: ${clientName} - Suspendido: ${new Date().toISOString()}`
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MikroTik API error:', errorText);
      return { success: false, error: 'Error al comunicar con MikroTik' };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('MikroTik connection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
    return { success: false, error: errorMessage };
  }
}
