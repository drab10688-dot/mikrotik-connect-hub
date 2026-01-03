import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  mikrotikId: string;
  chatId: string;
  message: string;
  clientId?: string;
  invoiceId?: string;
  contractId?: string;
  documentUrl?: string;
  documentName?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestBody = await req.json();
    const { mikrotikId, chatId, message, clientId, invoiceId, contractId, documentUrl, documentName } = body;

    console.log(`Telegram send request for mikrotik: ${mikrotikId}, chat: ${chatId}, hasDocument: ${!!documentUrl}`);

    // Get Telegram config
    const { data: config, error: configError } = await supabase
      .from("telegram_config")
      .select("*")
      .eq("mikrotik_id", mikrotikId)
      .single();

    if (configError || !config) {
      console.error("Config not found:", configError);
      return new Response(
        JSON.stringify({ error: "Configuración de Telegram no encontrada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!config.is_active) {
      return new Response(
        JSON.stringify({ error: "Telegram Bot está desactivado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sending Telegram message to chat: ${chatId}`);

    let telegramResult: any;
    let telegramResponse: Response;

    // If document URL is provided, send document first
    if (documentUrl) {
      const telegramDocUrl = `https://api.telegram.org/bot${config.bot_token}/sendDocument`;
      
      telegramResponse = await fetch(telegramDocUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          document: documentUrl,
          caption: message,
          parse_mode: "HTML",
        }),
      });

      telegramResult = await telegramResponse.json();
      console.log("Telegram sendDocument response:", JSON.stringify(telegramResult));
    } else {
      // Send text message only
      const telegramUrl = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
      
      telegramResponse = await fetch(telegramUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      telegramResult = await telegramResponse.json();
      console.log("Telegram API response:", JSON.stringify(telegramResult));
    }

    // Determine status
    const status = telegramResult.ok ? "sent" : "failed";
    const errorMessage = !telegramResult.ok ? telegramResult.description : null;
    const messageId = telegramResult.result?.message_id?.toString();

    // Log message to database
    const { error: insertError } = await supabase.from("telegram_messages").insert({
      mikrotik_id: mikrotikId,
      client_id: clientId || null,
      chat_id: chatId,
      message_type: documentUrl ? "document" : "text",
      message_content: message,
      related_invoice_id: invoiceId || null,
      related_contract_id: contractId || null,
      status,
      telegram_message_id: messageId || null,
      error_message: errorMessage,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      created_by: user.id,
    });

    if (insertError) {
      console.error("Error logging message:", insertError);
    }

    if (!telegramResult.ok) {
      return new Response(
        JSON.stringify({ 
          error: telegramResult.description || "Error al enviar mensaje",
          details: telegramResult 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId,
        message: "Mensaje enviado correctamente" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Telegram send error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
