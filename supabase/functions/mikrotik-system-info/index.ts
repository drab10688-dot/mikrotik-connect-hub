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

async function mikrotikRequest(config: MikroTikConfig, path: string) {
  const protocol = config.useTls ? 'https' : 'http';
  const url = `${protocol}://${config.host}${path}`;
  
  const authString = btoa(`${config.username}:${config.password}`);
  
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

  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { host, username, password, port, type } = await req.json();

    console.log(`Getting MikroTik system info - Type: ${type}`);

    const useTls = port === 443;
    const config: MikroTikConfig = {
      host: host,
      username,
      password,
      port,
      useTls,
    };

    let result;

    switch (type) {
      case 'resources':
        result = await mikrotikRequest(config, '/rest/system/resource');
        break;

      case 'interfaces':
        result = await mikrotikRequest(config, '/rest/interface');
        break;

      case 'ppp':
        result = await mikrotikRequest(config, '/rest/interface/ppp-client');
        break;

      case 'dhcp-leases':
        result = await mikrotikRequest(config, '/rest/ip/dhcp-server/lease');
        break;

      case 'hotspot-active':
        result = await mikrotikRequest(config, '/rest/ip/hotspot/active');
        break;

      default:
        result = await mikrotikRequest(config, '/rest/system/resource');
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-system-info:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error al obtener información del sistema',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
