const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { host, username, password, port, action, userData } = await req.json();

    console.log(`PPPoE action: ${action}`);

    const useTls = port === 443 || port === 8729;
    const config: MikroTikConfig = {
      host,
      username,
      password,
      port,
      useTls,
    };

    let result;

    switch (action) {
      case 'list':
        // Listar usuarios PPPoE
        result = await mikrotikRequest(config, '/rest/ppp/secret');
        break;

      case 'add':
        // Agregar usuario PPPoE
        result = await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
          name: userData.name,
          password: userData.password,
          service: userData.service || 'pppoe',
          profile: userData.profile || 'default',
          'local-address': userData.localAddress,
          'remote-address': userData.remoteAddress,
          comment: userData.comment || '',
        });
        break;

      case 'remove':
        // Eliminar usuario PPPoE
        await mikrotikRequest(config, `/rest/ppp/secret/${userData.id}`, 'DELETE');
        result = { success: true };
        break;

      case 'update':
        // Actualizar usuario PPPoE
        result = await mikrotikRequest(config, `/rest/ppp/secret/${userData.id}`, 'PATCH', {
          password: userData.password,
          profile: userData.profile,
          'local-address': userData.localAddress,
          'remote-address': userData.remoteAddress,
          comment: userData.comment,
        });
        break;

      case 'active':
        // Listar conexiones PPPoE activas
        result = await mikrotikRequest(config, '/rest/ppp/active');
        break;

      case 'disconnect':
        // Desconectar sesión PPPoE
        await mikrotikRequest(config, `/rest/ppp/active/${userData.id}/remove`, 'POST');
        result = { success: true };
        break;

      case 'profiles':
        // Listar perfiles PPP
        result = await mikrotikRequest(config, '/rest/ppp/profile');
        break;

      default:
        result = await mikrotikRequest(config, '/rest/ppp/secret');
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-pppoe:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error en operación PPPoE',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
