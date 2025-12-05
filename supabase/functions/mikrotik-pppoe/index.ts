import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function verifyUserAccess(supabase: any, userId: string, mikrotikId?: string): Promise<{ authorized: boolean; error?: string }> {
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (roleData?.role === 'super_admin') {
    return { authorized: true };
  }

  if (!mikrotikId) {
    return { authorized: true };
  }

  const { data: accessData } = await supabase
    .from('user_mikrotik_access')
    .select('id')
    .eq('user_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (accessData) {
    return { authorized: true };
  }

  const { data: secretaryData } = await supabase
    .from('secretary_assignments')
    .select('id')
    .eq('secretary_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (secretaryData) {
    return { authorized: true };
  }

  const { data: resellerData } = await supabase
    .from('reseller_assignments')
    .select('id')
    .eq('reseller_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (resellerData) {
    return { authorized: true };
  }

  return { authorized: false, error: 'No tienes acceso a este dispositivo MikroTik' };
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado - Token requerido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado - Sesión inválida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { host, username, password, port, action, userData, mikrotikId } = await req.json();

    console.log(`User ${user.id} - PPPoE action: ${action}`);

    const accessCheck = await verifyUserAccess(supabase, user.id, mikrotikId);
    if (!accessCheck.authorized) {
      console.error(`Access denied for user ${user.id} to device ${mikrotikId}`);
      return new Response(
        JSON.stringify({ success: false, error: accessCheck.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

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
        result = await mikrotikRequest(config, '/rest/ppp/secret');
        break;

      case 'add':
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
        await mikrotikRequest(config, `/rest/ppp/secret/${userData.id}`, 'DELETE');
        result = { success: true };
        break;

      case 'update':
        result = await mikrotikRequest(config, `/rest/ppp/secret/${userData.id}`, 'PATCH', {
          password: userData.password,
          profile: userData.profile,
          'local-address': userData.localAddress,
          'remote-address': userData.remoteAddress,
          comment: userData.comment,
        });
        break;

      case 'active':
        result = await mikrotikRequest(config, '/rest/ppp/active');
        break;

      case 'disconnect':
        await mikrotikRequest(config, `/rest/ppp/active/${userData.id}/remove`, 'POST');
        result = { success: true };
        break;

      case 'profiles':
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
