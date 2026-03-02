import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface MikroTikConfig {
  host: string;
  username: string;
  password: string;
  port: number;
  useTls: boolean;
}

async function mikrotikRequest(config: MikroTikConfig, path: string, method: string = 'GET', body?: any) {
  const protocol = config.useTls ? 'https' : 'http';
  const url = `${protocol}://${config.host}:${config.port}${path}`;
  
  const authString = btoa(`${config.username}:${config.password}`);
  
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mikrotikId, username, password } = await req.json();

    if (!mikrotikId || !username || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Credenciales requeridas' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Use service role to fetch device credentials
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get device credentials from DB
    const { data: device, error: deviceError } = await supabase
      .from('mikrotik_devices')
      .select('host, username, password, port, hotspot_url')
      .eq('id', mikrotikId)
      .eq('status', 'active')
      .single();

    if (deviceError || !device) {
      console.error('Device not found:', deviceError);
      return new Response(
        JSON.stringify({ success: false, error: 'Dispositivo no encontrado o inactivo' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    const useTls = device.port === 443;
    const config: MikroTikConfig = {
      host: device.host,
      username: device.username,
      password: device.password,
      port: device.port,
      useTls,
    };

    // Verify user exists in hotspot users
    const hotspotUsers = await mikrotikRequest(config, '/rest/ip/hotspot/user');
    const hotspotUser = hotspotUsers.find((u: any) => 
      u.name === username && u.password === password
    );

    if (!hotspotUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario o contraseña incorrectos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Check if user profile has a time limit
    const profile = hotspotUser.profile || 'default';
    
    // Get active sessions to check if already connected
    const activeSessions = await mikrotikRequest(config, '/rest/ip/hotspot/active');
    const isAlreadyConnected = activeSessions.some((s: any) => s.user === username);

    // Return success with user info and hotspot URL for redirect
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          username: hotspotUser.name,
          profile,
          hotspotUrl: device.hotspot_url || `http://${device.host}/login`,
          alreadyConnected: isAlreadyConnected,
          comment: hotspotUser.comment || '',
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Error in hotspot-login:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error al verificar credenciales',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
