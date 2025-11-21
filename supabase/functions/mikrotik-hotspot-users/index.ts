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
    const { host, username, password, port, action, userId, userData } = await req.json();

    console.log(`MikroTik Hotspot Users - Action: ${action}`);

    const useTls = port === 443;
    const config: MikroTikConfig = {
      host: host,
      username,
      password,
      port,
      useTls,
    };

    let result;

    switch (action) {
      case 'list':
        result = await mikrotikRequest(config, '/rest/ip/hotspot/user');
        break;

      case 'profiles':
      case 'list-profiles':
        result = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile');
        break;

      case 'add':
        result = await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', userData);
        break;

      case 'remove':
        result = await mikrotikRequest(config, `/rest/ip/hotspot/user/remove`, 'POST', { 
          '.id': userId 
        });
        break;

      case 'update':
        result = await mikrotikRequest(config, `/rest/ip/hotspot/user/set`, 'POST', {
          '.id': userId,
          ...userData
        });
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-hotspot-users:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error en operación de usuarios hotspot',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
