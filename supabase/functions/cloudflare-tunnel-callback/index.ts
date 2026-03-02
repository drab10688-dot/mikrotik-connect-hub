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
    const { mikrotik_id, tunnel_url, action, secret } = await req.json();

    if (!mikrotik_id || !secret) {
      return new Response(JSON.stringify({ error: "Missing mikrotik_id or secret" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the secret matches the one stored in cloudflare_config
    const { data: config, error: fetchError } = await supabase
      .from("cloudflare_config")
      .select("*")
      .eq("mikrotik_id", mikrotik_id)
      .maybeSingle();

    if (fetchError || !config) {
      return new Response(JSON.stringify({ error: "Config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the callback secret
    if (config.tunnel_id !== secret) {
      return new Response(JSON.stringify({ error: "Invalid secret" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "report_url") {
      // VPS script reports the tunnel URL
      const { error: updateError } = await supabase
        .from("cloudflare_config")
        .update({
          tunnel_url: tunnel_url,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true, message: "URL saved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "stopped") {
      const { error: updateError } = await supabase
        .from("cloudflare_config")
        .update({
          tunnel_url: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true, message: "Tunnel stopped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
