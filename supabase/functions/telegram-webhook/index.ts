import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const update: TelegramUpdate = await req.json();
    console.log("Received Telegram update:", JSON.stringify(update, null, 2));

    // Only process messages
    if (!update.message) {
      console.log("No message in update, skipping");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || "";
    const firstName = message.from.first_name;

    // Check if it's a /start command with parameter
    if (text.startsWith("/start")) {
      const parts = text.split(" ");
      const phoneParam = parts.length > 1 ? parts[1] : null;

      console.log(`Processing /start command. Chat ID: ${chatId}, Phone param: ${phoneParam}`);

      if (phoneParam) {
        // Clean the phone number - remove any non-numeric characters except +
        const cleanPhone = phoneParam.replace(/[^\d+]/g, "");
        
        // Try to find the client by phone number
        // We search with multiple variations to maximize matches
        const phoneVariations = [
          cleanPhone,
          cleanPhone.replace(/^\+/, ""), // Without + prefix
          cleanPhone.slice(-10), // Last 10 digits
          `+${cleanPhone}`, // With + prefix
        ];

        console.log("Searching for client with phone variations:", phoneVariations);

        let client = null;
        for (const phone of phoneVariations) {
          const { data, error } = await supabase
            .from("isp_clients")
            .select("id, client_name, phone, mikrotik_id")
            .or(`phone.eq.${phone},phone.ilike.%${phone.slice(-10)}%`)
            .limit(1)
            .maybeSingle();

          if (data && !error) {
            client = data;
            console.log("Found client:", client);
            break;
          }
        }

        if (client) {
          // Update the client's telegram_chat_id
          const { error: updateError } = await supabase
            .from("isp_clients")
            .update({ telegram_chat_id: chatId.toString() })
            .eq("id", client.id);

          if (updateError) {
            console.error("Error updating client:", updateError);
            throw updateError;
          }

          console.log(`Updated client ${client.id} with chat_id ${chatId}`);

          // Get the bot token to send confirmation
          const { data: telegramConfig } = await supabase
            .from("telegram_config")
            .select("bot_token")
            .eq("mikrotik_id", client.mikrotik_id)
            .maybeSingle();

          if (telegramConfig?.bot_token) {
            // Send confirmation message
            const confirmMessage = `✅ ¡Hola ${client.client_name}!\n\nTu cuenta ha sido vinculada exitosamente.\n\nAhora recibirás notificaciones de pago y avisos importantes por este medio.\n\n📱 Tu número registrado: ${client.phone}`;

            const telegramResponse = await fetch(
              `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: confirmMessage,
                  parse_mode: "HTML",
                }),
              }
            );

            const telegramResult = await telegramResponse.json();
            console.log("Telegram send result:", telegramResult);
          }

          return new Response(
            JSON.stringify({ ok: true, linked: true, client_id: client.id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          console.log("Client not found for phone:", phoneParam);
          
          // Try to find any telegram config to respond
          const { data: anyConfig } = await supabase
            .from("telegram_config")
            .select("bot_token")
            .limit(1)
            .maybeSingle();

          if (anyConfig?.bot_token) {
            await fetch(
              `https://api.telegram.org/bot${anyConfig.bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: `❌ No se encontró un cliente registrado con el número ${phoneParam}.\n\nPor favor, contacta al administrador para verificar tu registro.`,
                  parse_mode: "HTML",
                }),
              }
            );
          }
        }
      } else {
        // /start without parameter - just welcome message
        console.log("Start command without parameter");
        
        const { data: anyConfig } = await supabase
          .from("telegram_config")
          .select("bot_token")
          .limit(1)
          .maybeSingle();

        if (anyConfig?.bot_token) {
          await fetch(
            `https://api.telegram.org/bot${anyConfig.bot_token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: `¡Hola ${firstName}! 👋\n\nEste bot te enviará notificaciones de pago.\n\nSi recibiste un enlace de activación, por favor úsalo para vincular tu cuenta.\n\nTu Chat ID es: <code>${chatId}</code>`,
                parse_mode: "HTML",
              }),
            }
          );
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing webhook:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
