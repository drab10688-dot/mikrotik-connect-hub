import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateHost, validateUUID } from '../_shared/security.ts'

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

async function verifyUserAccess(supabase: any, userId: string, mikrotikId?: string): Promise<{ authorized: boolean; error?: string }> {
  // Check if user is super_admin (has access to everything)
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (roleData?.role === 'super_admin') {
    return { authorized: true };
  }

  // If no mikrotikId provided, user must be at least authenticated
  if (!mikrotikId) {
    return { authorized: true };
  }

  // Check user_mikrotik_access for admins/users
  const { data: accessData } = await supabase
    .from('user_mikrotik_access')
    .select('id')
    .eq('user_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (accessData) {
    return { authorized: true };
  }

  // Check secretary_assignments for secretaries
  const { data: secretaryData } = await supabase
    .from('secretary_assignments')
    .select('id')
    .eq('secretary_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (secretaryData) {
    return { authorized: true };
  }

  // Check reseller_assignments for resellers
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

async function getDeviceCredentials(supabase: any, mikrotikId: string): Promise<{ host: string; username: string; password: string; port: number; version: string } | null> {
  const { data, error } = await supabase
    .from('mikrotik_devices')
    .select('host, username, password, port, version')
    .eq('id', mikrotikId)
    .single();

  if (error || !data) {
    console.error('Error fetching device credentials:', error);
    return null;
  }

  return data;
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
    // Verify JWT and get user
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

    const { mikrotikId } = await req.json();

    // Validate mikrotikId
    const mikrotikIdError = validateUUID(mikrotikId, 'mikrotikId');
    if (mikrotikIdError) {
      return new Response(
        JSON.stringify({ success: false, error: mikrotikIdError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`User ${user.id} attempting to connect to MikroTik device ${mikrotikId}`);

    // Verify user has access to this device
    const accessCheck = await verifyUserAccess(supabase, user.id, mikrotikId);
    if (!accessCheck.authorized) {
      console.error(`Access denied for user ${user.id} to device ${mikrotikId}`);
      return new Response(
        JSON.stringify({ success: false, error: accessCheck.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Get device credentials from database (server-side only)
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const credentials = await getDeviceCredentials(serviceSupabase, mikrotikId);
    if (!credentials) {
      return new Response(
        JSON.stringify({ success: false, error: 'Dispositivo no encontrado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Validate host from database (SSRF prevention)
    const hostError = validateHost(credentials.host);
    if (hostError) {
      console.error(`SSRF attempt blocked - Invalid host in database: ${credentials.host}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Configuración de host inválida en el dispositivo' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Connecting to MikroTik at ${credentials.host}:${credentials.port}`);

    const useTls = credentials.port === 443 || credentials.port === 8729;

    const config: MikroTikConfig = {
      host: credentials.host,
      username: credentials.username,
      password: credentials.password,
      port: credentials.port,
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
    
    const errorMsg = (error as Error).message || 'Error al conectar con MikroTik';
    let userMessage = errorMsg;
    
    if (errorMsg.includes('Connection refused') || errorMsg.includes('ECONNREFUSED')) {
      userMessage = 'No se puede conectar al router. Para RouterOS v7:\n\n' +
        '1. Habilita el servicio web: /ip service set www-ssl disabled=no\n' +
        '2. O usa HTTP: /ip service set www disabled=no\n' +
        '3. Verifica firewall: permite acceso a puertos 80 o 443\n' +
        '4. Prueba con la IP local primero si estás conectado directamente';
    } else if (errorMsg.includes('HandshakeFailure') || errorMsg.includes('SSL')) {
      userMessage = 'Error SSL/TLS. Prueba con HTTP (puerto 80) en lugar de HTTPS.\n' +
        'En el router: /ip service set www disabled=no';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('AbortError')) {
      userMessage = 'Timeout de conexión. Verifica que el router esté accesible desde internet.';
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: userMessage,
        technicalError: errorMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
