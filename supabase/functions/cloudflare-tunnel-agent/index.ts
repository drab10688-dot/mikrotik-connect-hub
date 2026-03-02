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
    // Verify JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { mikrotik_id, action } = await req.json();

    if (!mikrotik_id || !action) {
      return new Response(JSON.stringify({ error: "Missing mikrotik_id or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get cloudflare config with agent info
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: config, error: fetchError } = await adminClient
      .from("cloudflare_config")
      .select("*")
      .eq("mikrotik_id", mikrotik_id)
      .maybeSingle();

    if (fetchError || !config) {
      return new Response(JSON.stringify({ error: "Cloudflare config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config.agent_host || !config.agent_secret) {
      return new Response(JSON.stringify({ error: "Agent not configured. Set VPS IP first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentUrl = `http://${config.agent_host}:${config.agent_port || 3847}`;

    // Proxy the action to the VPS agent
    let endpoint = "";
    let method = "POST";

    switch (action) {
      case "status":
        endpoint = "/status";
        method = "GET";
        break;
      case "start":
        endpoint = "/start";
        break;
      case "stop":
        endpoint = "/stop";
        break;
      case "install":
        endpoint = "/install";
        break;
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const agentResponse = await fetch(`${agentUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Secret": config.agent_secret,
      },
      signal: AbortSignal.timeout(30000),
    });

    const agentData = await agentResponse.json();

    // If tunnel started successfully, save the URL
    if (action === "start" && agentData.url) {
      await adminClient
        .from("cloudflare_config")
        .update({
          tunnel_url: agentData.url,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);
    }

    // If tunnel stopped, clear the URL
    if (action === "stop") {
      await adminClient
        .from("cloudflare_config")
        .update({
          tunnel_url: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);
    }

    return new Response(JSON.stringify(agentData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timed out");
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? "No se pudo conectar al agente en el VPS. Verifica que esté corriendo y el puerto esté abierto."
          : err.message,
      }),
      {
        status: isTimeout ? 504 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
