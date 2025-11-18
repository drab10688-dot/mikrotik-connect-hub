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

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { host, username, password, port, action, voucherData, count } = await req.json();

    console.log(`Voucher action: ${action}`);

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
      case 'generate':
        // Generar múltiples vouchers
        const vouchers = [];
        const voucherCount = count || 1;
        const profile = voucherData?.profile || 'default';
        const validity = voucherData?.validity || '1d';
        
        for (let i = 0; i < voucherCount; i++) {
          const username = generateRandomString(8);
          const password = generateRandomString(8);
          
          // Crear usuario hotspot
          await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
            name: username,
            password: password,
            profile: profile,
            comment: `Voucher ${new Date().toISOString()}`,
          });
          
          vouchers.push({ username, password, profile, validity });
        }
        
        result = vouchers;
        break;

      case 'list':
        // Listar todos los usuarios (vouchers)
        result = await mikrotikRequest(config, '/rest/ip/hotspot/user');
        break;

      case 'delete':
        // Eliminar voucher por ID
        await mikrotikRequest(config, `/rest/ip/hotspot/user/${voucherData.id}`, 'DELETE');
        result = { success: true };
        break;

      case 'bulk-delete':
        // Eliminar múltiples vouchers
        const users = await mikrotikRequest(config, '/rest/ip/hotspot/user');
        const toDelete = users.filter((u: any) => u.comment?.includes('Voucher'));
        
        for (const user of toDelete) {
          await mikrotikRequest(config, `/rest/ip/hotspot/user/${user['.id']}`, 'DELETE');
        }
        
        result = { deleted: toDelete.length };
        break;

      default:
        result = await mikrotikRequest(config, '/rest/ip/hotspot/user');
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-vouchers:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error en operación de vouchers',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
