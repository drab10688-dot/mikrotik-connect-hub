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

    const { action, ...params } = await req.json();
    console.log('Payment gateway action:', action, params);

    switch (action) {
      case 'create-payment': {
        const { platform, invoice_id, amount, description, customer_email, mikrotik_id } = params;

        // Get platform config
        const { data: platformConfig, error: configError } = await supabase
          .from('payment_platforms')
          .select('*')
          .eq('mikrotik_id', mikrotik_id)
          .eq('platform', platform)
          .eq('is_active', true)
          .single();

        if (configError || !platformConfig) {
          throw new Error(`Plataforma ${platform} no configurada o inactiva`);
        }

        // Create transaction record
        const { data: transaction, error: txError } = await supabase
          .from('payment_transactions')
          .insert({
            invoice_id,
            mikrotik_id,
            platform,
            amount,
            status: 'pending',
            payer_email: customer_email
          })
          .select()
          .single();

        if (txError) {
          console.error('Transaction creation error:', txError);
          throw new Error('Error al crear transacción');
        }

        let paymentUrl = '';

        if (platform === 'wompi') {
          // Wompi integration
          const wompiUrl = platformConfig.environment === 'production'
            ? 'https://checkout.wompi.co/l/'
            : 'https://checkout.wompi.co/l/';

          // For Wompi, we'll create a simple redirect to their hosted checkout
          // In production, you'd create a payment link via their API
          const reference = `INV-${invoice_id.slice(0, 8)}-${Date.now()}`;
          
          // Store reference for webhook matching
          await supabase
            .from('payment_transactions')
            .update({ external_reference: reference })
            .eq('id', transaction.id);

          // Wompi checkout redirect (simplified - in production use their API to create proper links)
          paymentUrl = `https://checkout.wompi.co/p/?public-key=${platformConfig.public_key}&currency=COP&amount-in-cents=${amount * 100}&reference=${reference}&redirect-url=${encodeURIComponent(`${supabaseUrl}/functions/v1/payment-webhook?platform=wompi`)}`;

        } else if (platform === 'mercadopago') {
          // Mercado Pago integration
          const mpUrl = platformConfig.environment === 'production'
            ? 'https://api.mercadopago.com'
            : 'https://api.mercadopago.com';

          const reference = `INV-${invoice_id.slice(0, 8)}-${Date.now()}`;

          // Create preference
          const preferenceResponse = await fetch(`${mpUrl}/checkout/preferences`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${platformConfig.private_key}`
            },
            body: JSON.stringify({
              items: [{
                title: description,
                quantity: 1,
                unit_price: amount,
                currency_id: 'COP'
              }],
              external_reference: reference,
              back_urls: {
                success: `${supabaseUrl}/functions/v1/payment-webhook?platform=mercadopago&status=success`,
                failure: `${supabaseUrl}/functions/v1/payment-webhook?platform=mercadopago&status=failure`,
                pending: `${supabaseUrl}/functions/v1/payment-webhook?platform=mercadopago&status=pending`
              },
              auto_return: 'approved',
              notification_url: `${supabaseUrl}/functions/v1/payment-webhook?platform=mercadopago`
            })
          });

          if (!preferenceResponse.ok) {
            const errorData = await preferenceResponse.text();
            console.error('Mercado Pago error:', errorData);
            throw new Error('Error al crear preferencia de pago');
          }

          const preference = await preferenceResponse.json();
          
          await supabase
            .from('payment_transactions')
            .update({ 
              external_reference: reference,
              transaction_id: preference.id 
            })
            .eq('id', transaction.id);

          paymentUrl = preference.init_point || preference.sandbox_init_point;
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            transaction_id: transaction.id,
            redirect_url: paymentUrl,
            checkout_url: paymentUrl 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'verify-payment': {
        const { transaction_id, platform, external_reference } = params;

        // Get transaction
        const { data: transaction, error: txError } = await supabase
          .from('payment_transactions')
          .select('*, client_invoices(client_id)')
          .eq('id', transaction_id)
          .single();

        if (txError || !transaction) {
          throw new Error('Transacción no encontrada');
        }

        // Get platform config
        const { data: platformConfig } = await supabase
          .from('payment_platforms')
          .select('*')
          .eq('mikrotik_id', transaction.mikrotik_id)
          .eq('platform', platform)
          .single();

        if (!platformConfig) {
          throw new Error('Configuración de plataforma no encontrada');
        }

        let paymentStatus = 'pending';

        if (platform === 'wompi') {
          // Verify with Wompi
          const wompiUrl = platformConfig.environment === 'production'
            ? 'https://production.wompi.co/v1'
            : 'https://sandbox.wompi.co/v1';

          const verifyResponse = await fetch(
            `${wompiUrl}/transactions?reference=${external_reference}`,
            {
              headers: {
                'Authorization': `Bearer ${platformConfig.private_key}`
              }
            }
          );

          if (verifyResponse.ok) {
            const data = await verifyResponse.json();
            if (data.data && data.data.length > 0) {
              const tx = data.data[0];
              paymentStatus = tx.status === 'APPROVED' ? 'approved' : 
                             tx.status === 'DECLINED' ? 'rejected' : 'pending';
            }
          }

        } else if (platform === 'mercadopago') {
          // Verify with Mercado Pago
          const searchResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/search?external_reference=${external_reference}`,
            {
              headers: {
                'Authorization': `Bearer ${platformConfig.private_key}`
              }
            }
          );

          if (searchResponse.ok) {
            const data = await searchResponse.json();
            if (data.results && data.results.length > 0) {
              const payment = data.results[0];
              paymentStatus = payment.status === 'approved' ? 'approved' :
                             payment.status === 'rejected' ? 'rejected' : 'pending';
            }
          }
        }

        // Update transaction
        await supabase
          .from('payment_transactions')
          .update({ status: paymentStatus })
          .eq('id', transaction_id);

        // If approved, update invoice and billing
        if (paymentStatus === 'approved' && transaction.invoice_id) {
          await supabase
            .from('client_invoices')
            .update({ 
              status: 'paid',
              paid_at: new Date().toISOString(),
              paid_via: platform,
              payment_reference: external_reference
            })
            .eq('id', transaction.invoice_id);

          // Update billing settings
          if (transaction.client_invoices?.client_id) {
            await supabase
              .from('client_billing_settings')
              .update({
                last_payment_date: new Date().toISOString().split('T')[0],
                is_suspended: false,
                suspended_at: null
              })
              .eq('client_id', transaction.client_invoices.client_id);
          }
        }

        return new Response(
          JSON.stringify({ success: true, status: paymentStatus }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'suspend-delinquent': {
        const { mikrotik_id, client_id, username, ip_address } = params;

        // Get mikrotik device info
        const { data: device, error: deviceError } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('id', mikrotik_id)
          .single();

        if (deviceError || !device) {
          throw new Error('Dispositivo MikroTik no encontrado');
        }

        console.log(`Suspending client ${username} (${ip_address}) on device ${device.name}`);

        // Add to address list via MikroTik API
        const mikrotikResult = await addToAddressList(device, ip_address, username);

        // Update billing settings
        await supabase
          .from('client_billing_settings')
          .update({
            is_suspended: true,
            suspended_at: new Date().toISOString()
          })
          .eq('client_id', client_id);

        return new Response(
          JSON.stringify({ success: true, mikrotik_result: mikrotikResult }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reactivate-client': {
        const { mikrotik_id, client_id, username, ip_address } = params;

        // Get mikrotik device info
        const { data: device } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('id', mikrotik_id)
          .single();

        if (!device) {
          throw new Error('Dispositivo MikroTik no encontrado');
        }

        console.log(`Reactivating client ${username} (${ip_address}) on device ${device.name}`);

        // Remove from address list via MikroTik API
        const mikrotikResult = await removeFromAddressList(device, ip_address);

        // Update billing settings
        await supabase
          .from('client_billing_settings')
          .update({
            is_suspended: false,
            suspended_at: null
          })
          .eq('client_id', client_id);

        return new Response(
          JSON.stringify({ success: true, mikrotik_result: mikrotikResult }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error(`Acción no reconocida: ${action}`);
    }

  } catch (error: unknown) {
    console.error('Payment gateway error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to add IP to MikroTik address list
async function addToAddressList(device: any, ipAddress: string, comment: string) {
  try {
    const baseUrl = `https://${device.host}:${device.port || 8729}`;
    
    // Using REST API (RouterOS 7+) or RouterOS API
    const response = await fetch(`${baseUrl}/rest/ip/firewall/address-list`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${device.username}:${device.password}`)
      },
      body: JSON.stringify({
        list: 'morosos',
        address: ipAddress,
        comment: `Moroso: ${comment} - ${new Date().toISOString()}`
      })
    });

    if (!response.ok) {
      console.error('MikroTik API error:', await response.text());
      return { success: false, error: 'Error al comunicar con MikroTik' };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('MikroTik connection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
    return { success: false, error: errorMessage };
  }
}

// Helper function to remove IP from MikroTik address list
async function removeFromAddressList(device: any, ipAddress: string) {
  try {
    const baseUrl = `https://${device.host}:${device.port || 8729}`;
    
    // First find the entry
    const findResponse = await fetch(`${baseUrl}/rest/ip/firewall/address-list?list=morosos&address=${ipAddress}`, {
      headers: {
        'Authorization': 'Basic ' + btoa(`${device.username}:${device.password}`)
      }
    });

    if (!findResponse.ok) {
      return { success: false, error: 'Error al buscar en address list' };
    }

    const entries = await findResponse.json();
    
    if (entries && entries.length > 0) {
      // Remove the entry
      const deleteResponse = await fetch(`${baseUrl}/rest/ip/firewall/address-list/${entries[0]['.id']}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Basic ' + btoa(`${device.username}:${device.password}`)
        }
      });

      if (!deleteResponse.ok) {
        return { success: false, error: 'Error al eliminar de address list' };
      }
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('MikroTik connection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
    return { success: false, error: errorMessage };
  }
}
