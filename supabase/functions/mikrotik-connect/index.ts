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
  const attempts = [
    { port: config.port, useTls: config.port === 443 || config.port === 8729 },
    { port: 443, useTls: true },
    { port: 80, useTls: false },
    { port: 8729, useTls: true },
    { port: 8728, useTls: false },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    const protocol = attempt.useTls ? 'https' : 'http';
    const url = `${protocol}://${config.host}:${attempt.port}/rest/system/resource`;
    
    console.log(`Trying ${config.host}:${attempt.port} (${protocol})`);
    
    const authString = btoa(`${config.username}:${config.password}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`Success on port ${attempt.port}`);
      return { success: true, data, port: attempt.port };
    } catch (error) {
      lastError = error as Error;
      console.log(`Failed on port ${attempt.port}: ${lastError.message}`);
      continue;
    }
  }

  throw lastError || new Error('All connection attempts failed');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { host, username, password, port, version } = await req.json();

    console.log(`Attempting to connect to MikroTik at ${host}:${port} (${version})`);

    const useTls = port === 443 || port === 8729;
    const actualPort = port || 80;

    const config: MikroTikConfig = {
      host: host,
      username,
      password,
      port: actualPort,
      useTls,
    };

    const result = await connectToMikroTik(config);

    console.log(`Successfully connected to MikroTik on port ${result.port}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Conectado exitosamente en puerto ${result.port}`,
        data: result.data,
        port: result.port,
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
