import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

async function testTcpConnection(host: string, port: number, timeout: number = 5000): Promise<{ success: boolean; time?: number; error?: string }> {
  const startTime = Date.now();
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname: host, port }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      )
    ]);
    
    const time = Date.now() - startTime;
    conn.close();
    return { success: true, time };
  } catch (error) {
    return { 
      success: false, 
      error: (error as Error).message,
      time: Date.now() - startTime
    };
  }
}

async function scanPorts(host: string, ports: number[]): Promise<{ port: number; open: boolean; service?: string }[]> {
  const serviceMap: Record<number, string> = {
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    80: 'HTTP',
    443: 'HTTPS',
    8080: 'HTTP-Alt',
    8291: 'WinBox',
    8728: 'API',
    8729: 'API-SSL',
  };

  const results = await Promise.all(
    ports.map(async (port) => {
      const result = await testTcpConnection(host, port, 3000);
      return {
        port,
        open: result.success,
        service: serviceMap[port],
      };
    })
  );

  return results;
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

    const { host, action, port, ports, mikrotikId } = await req.json();

    console.log(`User ${user.id} - Network diagnostics - Action: ${action}, Host: ${host}`);

    const accessCheck = await verifyUserAccess(supabase, user.id, mikrotikId);
    if (!accessCheck.authorized) {
      console.error(`Access denied for user ${user.id} to device ${mikrotikId}`);
      return new Response(
        JSON.stringify({ success: false, error: accessCheck.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    let result;

    switch (action) {
      case 'tcp-test':
        result = await testTcpConnection(host, port || 8728);
        break;

      case 'port-scan':
        const portsToScan = ports || [21, 22, 23, 80, 443, 8080, 8291, 8728, 8729];
        result = await scanPorts(host, portsToScan);
        break;

      case 'full-diagnostic':
        const commonPorts = [21, 22, 23, 80, 443, 8080, 8291, 8728, 8729];
        const [tcpTest, portScan] = await Promise.all([
          testTcpConnection(host, port || 8728),
          scanPorts(host, commonPorts)
        ]);
        
        result = {
          tcpTest,
          portScan,
          host,
          timestamp: new Date().toISOString(),
        };
        break;

      default:
        throw new Error('Invalid action');
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in network-diagnostics:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error en diagnóstico de red',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
