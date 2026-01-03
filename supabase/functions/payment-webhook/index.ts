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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const platform = url.searchParams.get('platform');
    
    console.log('Webhook received for platform:', platform);

    let body: any = {};
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      formData.forEach((value, key) => {
        body[key] = value;
      });
    }

    console.log('Webhook body:', JSON.stringify(body, null, 2));

    if (platform === 'wompi') {
      // Wompi webhook handling
      const event = body.event;
      const data = body.data?.transaction;

      if (!data) {
        console.log('No transaction data in Wompi webhook');
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const reference = data.reference;
      const status = data.status;

      console.log(`Wompi transaction ${reference} status: ${status}`);

      // Find transaction by reference
      const { data: transaction, error: txError } = await supabase
        .from('payment_transactions')
        .select('*, client_invoices(client_id, mikrotik_id)')
        .eq('external_reference', reference)
        .single();

      if (txError || !transaction) {
        console.error('Transaction not found for reference:', reference);
        return new Response(JSON.stringify({ error: 'Transaction not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const paymentStatus = status === 'APPROVED' ? 'approved' : 
                           status === 'DECLINED' ? 'rejected' : 
                           status === 'VOIDED' ? 'cancelled' : 'pending';

      // Update transaction
      await supabase
        .from('payment_transactions')
        .update({ 
          status: paymentStatus,
          transaction_id: data.id,
          raw_response: data
        })
        .eq('id', transaction.id);

      // If approved, update invoice and reactivate client
      if (paymentStatus === 'approved' && transaction.invoice_id) {
        await handlePaymentApproved(supabase, transaction);
      }

    } else if (platform === 'mercadopago') {
      // Mercado Pago webhook handling
      const topic = body.topic || body.type;
      const paymentId = body.data?.id || body.id;

      console.log(`Mercado Pago webhook - topic: ${topic}, paymentId: ${paymentId}`);

      if (topic === 'payment' && paymentId) {
        // Find transaction
        const { data: transactions } = await supabase
          .from('payment_transactions')
          .select('*, client_invoices(client_id, mikrotik_id)')
          .eq('platform', 'mercadopago')
          .eq('status', 'pending');

        // Get platform config to verify payment
        if (transactions && transactions.length > 0) {
          const transaction = transactions[0];
          
          const { data: platformConfig } = await supabase
            .from('payment_platforms')
            .select('private_key')
            .eq('mikrotik_id', transaction.mikrotik_id)
            .eq('platform', 'mercadopago')
            .single();

          if (platformConfig) {
            // Verify payment with Mercado Pago
            const mpResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/${paymentId}`,
              {
                headers: {
                  'Authorization': `Bearer ${platformConfig.private_key}`
                }
              }
            );

            if (mpResponse.ok) {
              const mpData = await mpResponse.json();
              const paymentStatus = mpData.status === 'approved' ? 'approved' :
                                   mpData.status === 'rejected' ? 'rejected' :
                                   mpData.status === 'refunded' ? 'refunded' : 'pending';

              // Find transaction by external reference
              const externalRef = mpData.external_reference;
              const { data: matchedTx } = await supabase
                .from('payment_transactions')
                .select('*, client_invoices(client_id, mikrotik_id)')
                .eq('external_reference', externalRef)
                .single();

              if (matchedTx) {
                await supabase
                  .from('payment_transactions')
                  .update({
                    status: paymentStatus,
                    transaction_id: paymentId.toString(),
                    payer_email: mpData.payer?.email,
                    payer_name: `${mpData.payer?.first_name || ''} ${mpData.payer?.last_name || ''}`.trim(),
                    raw_response: mpData
                  })
                  .eq('id', matchedTx.id);

                if (paymentStatus === 'approved') {
                  await handlePaymentApproved(supabase, matchedTx);
                }
              }
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handlePaymentApproved(supabase: any, transaction: any) {
  console.log('Handling approved payment for transaction:', transaction.id);

  // Update invoice status
  if (transaction.invoice_id) {
    await supabase
      .from('client_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_via: transaction.platform,
        payment_reference: transaction.external_reference
      })
      .eq('id', transaction.invoice_id);
  }

  // Get client info
  const clientId = transaction.client_invoices?.client_id;
  const mikrotikId = transaction.client_invoices?.mikrotik_id || transaction.mikrotik_id;

  if (clientId) {
    // Update billing settings
    await supabase
      .from('client_billing_settings')
      .update({
        last_payment_date: new Date().toISOString().split('T')[0],
        is_suspended: false,
        suspended_at: null
      })
      .eq('client_id', clientId);

    // Get client IP to remove from morosos list
    const { data: client } = await supabase
      .from('isp_clients')
      .select('assigned_ip, username')
      .eq('id', clientId)
      .single();

    if (client?.assigned_ip && mikrotikId) {
      console.log(`Reactivating client ${client.username} with IP ${client.assigned_ip}`);
      
      // Call payment-gateway to reactivate
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      await fetch(`${supabaseUrl}/functions/v1/payment-gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          action: 'reactivate-client',
          mikrotik_id: mikrotikId,
          client_id: clientId,
          username: client.username,
          ip_address: client.assigned_ip
        })
      });
    }
  }
}
