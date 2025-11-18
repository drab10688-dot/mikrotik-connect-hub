import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MikroTikConfig {
  host: string;
  username: string;
  password: string;
  port: number;
  useTls: boolean;
}

async function connectToMikroTik(config: MikroTikConfig) {
  const protocol = config.useTls ? 'https' : 'http';
  const url = `${protocol}://${config.host}/rest/system/resource`;
  
  const authString = btoa(`${config.username}:${config.password}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('MikroTik connection error:', error);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { host, username, password, port, version } = await req.json();

    console.log(`Attempting to connect to MikroTik at ${host}:${port} (${version})`);

    const useTls = port === 443;
    const actualPort = port || (useTls ? 443 : 80);

    const config: MikroTikConfig = {
      host: `${host}:${actualPort}`,
      username,
      password,
      port: actualPort,
      useTls,
    };

    const result = await connectToMikroTik(config);

    console.log('Successfully connected to MikroTik');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Conectado exitosamente',
        data: result.data,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-connect:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error al conectar con MikroTik',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
