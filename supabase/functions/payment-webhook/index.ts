import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWompiSignature, verifyMercadoPagoSignature } from "../_shared/security.ts";

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

    // Clone the request to read body multiple times if needed
    const rawBody = await req.text();
    let body: any = {};
    
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        console.error('Failed to parse JSON body');
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody);
      formData.forEach((value, key) => {
        body[key] = value;
      });
    }

    console.log('Webhook body received for platform:', platform);

    if (platform === 'wompi') {
      // Wompi webhook handling with signature verification
      const signature = req.headers.get('x-event-checksum');
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

      // Find transaction by reference to get the mikrotik_id for webhook secret lookup
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

      // Get webhook secret for signature verification
      const { data: platformConfig } = await supabase
        .from('payment_platforms')
        .select('webhook_secret')
        .eq('mikrotik_id', transaction.mikrotik_id)
        .eq('platform', 'wompi')
        .eq('is_active', true)
        .single();

      // Verify signature if webhook secret is configured
      if (platformConfig?.webhook_secret) {
        const isValidSignature = await verifyWompiSignature(body, signature, platformConfig.webhook_secret);
        if (!isValidSignature) {
          console.error('Invalid Wompi webhook signature');
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        console.log('Wompi webhook signature verified successfully');
      } else {
        console.warn('No webhook secret configured for Wompi - signature verification skipped (NOT RECOMMENDED)');
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
      // Mercado Pago webhook handling with signature verification
      const xSignature = req.headers.get('x-signature');
      const xRequestId = req.headers.get('x-request-id');
      
      const topic = body.topic || body.type;
      const paymentId = body.data?.id || body.id;

      console.log(`Mercado Pago webhook - topic: ${topic}, paymentId: ${paymentId}`);

      if (topic === 'payment' && paymentId) {
        // Find pending transactions to get mikrotik_id for verification
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
            .select('private_key, webhook_secret')
            .eq('mikrotik_id', transaction.mikrotik_id)
            .eq('platform', 'mercadopago')
            .eq('is_active', true)
            .single();

          if (platformConfig) {
            // Verify signature if webhook secret is configured
            if (platformConfig.webhook_secret) {
              const isValidSignature = await verifyMercadoPagoSignature(
                paymentId.toString(),
                xSignature,
                xRequestId,
                platformConfig.webhook_secret
              );
              
              if (!isValidSignature) {
                console.error('Invalid Mercado Pago webhook signature');
                return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                  status: 401,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              console.log('Mercado Pago webhook signature verified successfully');
            } else {
              console.warn('No webhook secret configured for Mercado Pago - signature verification skipped (NOT RECOMMENDED)');
            }

            // Verify payment with Mercado Pago API
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
    } else {
      console.warn('Unknown payment platform:', platform);
      return new Response(JSON.stringify({ error: 'Unknown platform' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
