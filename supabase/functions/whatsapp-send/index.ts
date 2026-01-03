import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  mikrotikId: string;
  phoneNumber: string;
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
    const { mikrotikId, phoneNumber, message, clientId, invoiceId, contractId, documentUrl, documentName } = body;

    console.log(`WhatsApp send request for mikrotik: ${mikrotikId}, phone: ${phoneNumber}, hasDocument: ${!!documentUrl}`);

    // Get WhatsApp config
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("*")
      .eq("mikrotik_id", mikrotikId)
      .single();

    if (configError || !config) {
      console.error("Config not found:", configError);
      return new Response(
        JSON.stringify({ error: "Configuración de WhatsApp no encontrada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!config.is_active) {
      return new Response(
        JSON.stringify({ error: "WhatsApp API está desactivada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format phone number (remove spaces, dashes, etc)
    const formattedPhone = phoneNumber.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "");

    console.log(`Sending WhatsApp message to: ${formattedPhone}`);

    // Send message via WhatsApp Business API
    const whatsappUrl = `https://graph.facebook.com/v18.0/${config.phone_number_id}/messages`;
    
    let messagePayload: any;
    
    if (documentUrl) {
      // Send document with caption
      messagePayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone,
        type: "document",
        document: {
          link: documentUrl,
          caption: message,
          filename: documentName || "Factura.pdf"
        },
      };
    } else {
      // Send text message
      messagePayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone,
        type: "text",
        text: {
          preview_url: true,
          body: message,
        },
      };
    }
    
    const whatsappResponse = await fetch(whatsappUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messagePayload),
    });

    const whatsappResult = await whatsappResponse.json();
    console.log("WhatsApp API response:", JSON.stringify(whatsappResult));

    // Determine status
    const status = whatsappResponse.ok ? "sent" : "failed";
    const errorMessage = !whatsappResponse.ok ? whatsappResult.error?.message : null;
    const messageId = whatsappResult.messages?.[0]?.id;

    // Log message to database
    const { error: insertError } = await supabase.from("whatsapp_messages").insert({
      mikrotik_id: mikrotikId,
      client_id: clientId || null,
      phone_number: formattedPhone,
      message_type: documentUrl ? "document" : "text",
      message_content: message,
      related_invoice_id: invoiceId || null,
      related_contract_id: contractId || null,
      status,
      whatsapp_message_id: messageId || null,
      error_message: errorMessage,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      created_by: user.id,
    });

    if (insertError) {
      console.error("Error logging message:", insertError);
    }

    if (insertError) {
      console.error("Error logging message:", insertError);
    }

    if (!whatsappResponse.ok) {
      return new Response(
        JSON.stringify({ 
          error: whatsappResult.error?.message || "Error al enviar mensaje",
          details: whatsappResult 
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
    console.error("WhatsApp send error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
