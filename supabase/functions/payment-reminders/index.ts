import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting payment reminders check...");

    // Get all pending invoices with client and billing settings
    const { data: invoices, error: invoicesError } = await supabase
      .from("client_invoices")
      .select(`
        *,
        isp_clients (
          id,
          client_name,
          phone,
          telegram_chat_id,
          mikrotik_id,
          created_by
        ),
        client_billing_settings:client_billing_settings!client_billing_settings_client_id_fkey (
          reminder_days_before
        )
      `)
      .eq("status", "pending")
      .gte("due_date", new Date().toISOString().split("T")[0]);

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError);
      throw invoicesError;
    }

    console.log(`Found ${invoices?.length || 0} pending invoices`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let telegramSent = 0;
    let whatsappSent = 0;

    for (const invoice of invoices || []) {
      const client = invoice.isp_clients;
      if (!client) continue;

      // Get reminder days (default to 3 if not set)
      const billingSettings = invoice.client_billing_settings?.[0];
      const reminderDays = billingSettings?.reminder_days_before ?? 3;

      // Calculate days until due
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Only send reminder if days match
      if (daysUntilDue !== reminderDays) continue;

      console.log(`Sending reminder for invoice ${invoice.invoice_number} to ${client.client_name} (${daysUntilDue} days until due)`);

      const reminderMessage = 
        `📅 *Recordatorio de Pago*\n\n` +
        `Hola ${client.client_name},\n\n` +
        `Te recordamos que tienes un pago próximo a vencer:\n\n` +
        `📄 *Factura:* ${invoice.invoice_number}\n` +
        `💰 *Monto:* $${Number(invoice.amount).toLocaleString()} COP\n` +
        `📆 *Vence:* ${new Date(invoice.due_date).toLocaleDateString("es-CO")}\n` +
        `⏰ *Días restantes:* ${daysUntilDue}\n\n` +
        `Por favor realiza tu pago a tiempo para evitar interrupciones en el servicio. 🌐`;

      // Send Telegram notification
      if (client.telegram_chat_id) {
        try {
          const { data: telegramConfig } = await supabase
            .from("telegram_config")
            .select("*")
            .eq("mikrotik_id", client.mikrotik_id)
            .eq("is_active", true)
            .single();

          if (telegramConfig) {
            const telegramUrl = `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`;
            
            const telegramResponse = await fetch(telegramUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: client.telegram_chat_id,
                text: reminderMessage,
                parse_mode: "Markdown",
              }),
            });

            const telegramResult = await telegramResponse.json();
            console.log(`Telegram reminder sent to ${client.client_name}:`, telegramResult.ok);

            // Log the message
            await supabase.from("telegram_messages").insert({
              mikrotik_id: client.mikrotik_id,
              client_id: client.id,
              chat_id: client.telegram_chat_id,
              message_type: "payment_reminder",
              message_content: reminderMessage,
              related_invoice_id: invoice.id,
              status: telegramResult.ok ? "sent" : "failed",
              telegram_message_id: telegramResult.result?.message_id?.toString() || null,
              error_message: !telegramResult.ok ? telegramResult.description : null,
              sent_at: telegramResult.ok ? new Date().toISOString() : null,
              created_by: client.created_by,
            });

            if (telegramResult.ok) telegramSent++;
          }
        } catch (telegramError) {
          console.error("Telegram error:", telegramError);
        }
      }

      // Send WhatsApp notification
      if (client.phone) {
        try {
          const { data: whatsappConfig } = await supabase
            .from("whatsapp_config")
            .select("*")
            .eq("mikrotik_id", client.mikrotik_id)
            .eq("is_active", true)
            .single();

          if (whatsappConfig) {
            const formattedPhone = client.phone.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "");

            const whatsappUrl = `https://graph.facebook.com/v18.0/${whatsappConfig.phone_number_id}/messages`;
            
            const whatsappResponse = await fetch(whatsappUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${whatsappConfig.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: formattedPhone,
                type: "text",
                text: {
                  preview_url: false,
                  body: reminderMessage,
                },
              }),
            });

            const whatsappResult = await whatsappResponse.json();
            console.log(`WhatsApp reminder sent to ${client.client_name}:`, whatsappResponse.ok);

            // Log the message
            await supabase.from("whatsapp_messages").insert({
              mikrotik_id: client.mikrotik_id,
              client_id: client.id,
              phone_number: formattedPhone,
              message_type: "payment_reminder",
              message_content: reminderMessage,
              related_invoice_id: invoice.id,
              status: whatsappResponse.ok ? "sent" : "failed",
              whatsapp_message_id: whatsappResult.messages?.[0]?.id || null,
              error_message: !whatsappResponse.ok ? whatsappResult.error?.message : null,
              sent_at: whatsappResponse.ok ? new Date().toISOString() : null,
              created_by: client.created_by,
            });

            if (whatsappResponse.ok) whatsappSent++;
          }
        } catch (whatsappError) {
          console.error("WhatsApp error:", whatsappError);
        }
      }
    }

    console.log(`Reminders sent - Telegram: ${telegramSent}, WhatsApp: ${whatsappSent}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Reminders processed`,
        telegram_sent: telegramSent,
        whatsapp_sent: whatsappSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in payment-reminders:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
