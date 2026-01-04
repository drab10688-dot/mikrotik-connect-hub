import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function verifyUserAccess(serviceSupabase: any, userId: string, mikrotikId?: string): Promise<{ authorized: boolean; error?: string }> {
  // Use service role client to bypass RLS and check access
  const { data: roleData } = await serviceSupabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  console.log(`User ${userId} role:`, roleData?.role);

  if (roleData?.role === 'super_admin') {
    return { authorized: true };
  }

  if (!mikrotikId) {
    return { authorized: true };
  }

  // Check admin access via user_mikrotik_access
  if (roleData?.role === 'admin') {
    const { data: accessData } = await serviceSupabase
      .from('user_mikrotik_access')
      .select('id')
      .eq('user_id', userId)
      .eq('mikrotik_id', mikrotikId)
      .single();

    console.log(`Admin access check for device ${mikrotikId}:`, accessData);

    if (accessData) {
      return { authorized: true };
    }
  }

  // Check secretary access
  if (roleData?.role === 'secretary') {
    const { data: secretaryData } = await serviceSupabase
      .from('secretary_assignments')
      .select('id')
      .eq('secretary_id', userId)
      .eq('mikrotik_id', mikrotikId)
      .single();

    console.log(`Secretary access check for device ${mikrotikId}:`, secretaryData);

    if (secretaryData) {
      return { authorized: true };
    }
  }

  // Check reseller access
  if (roleData?.role === 'reseller') {
    const { data: resellerData } = await serviceSupabase
      .from('reseller_assignments')
      .select('id')
      .eq('reseller_id', userId)
      .eq('mikrotik_id', mikrotikId)
      .single();

    console.log(`Reseller access check for device ${mikrotikId}:`, resellerData);

    if (resellerData) {
      return { authorized: true };
    }
  }

  // Fallback: check all access tables regardless of role
  const { data: fallbackAccess } = await serviceSupabase
    .from('user_mikrotik_access')
    .select('id')
    .eq('user_id', userId)
    .eq('mikrotik_id', mikrotikId)
    .single();

  if (fallbackAccess) {
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

class MikroTikAPI {
  private conn: Deno.Conn | null = null;
  private buffer: Uint8Array = new Uint8Array(0);

  async connect(host: string, port: number, username: string, password: string, useTls: boolean) {
    try {
      const connectOptions = useTls 
        ? { hostname: host, port }
        : { hostname: host, port };
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 60 seconds')), 60000)
      );
      
      this.conn = await Promise.race([
        useTls 
          ? Deno.connectTls(connectOptions)
          : Deno.connect(connectOptions),
        timeoutPromise
      ]) as Deno.Conn;

      await this.login(username, password);
      return true;
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  private async login(username: string, password: string) {
    await this.sendCommand(['/login', `=name=${username}`, `=password=${password}`]);
    const response = await this.readResponse();
    
    if (response.type === '!done') {
      return true;
    }
    
    throw new Error('Login failed');
  }

  private encodeLength(length: number): Uint8Array {
    if (length < 0x80) {
      return new Uint8Array([length]);
    } else if (length < 0x4000) {
      return new Uint8Array([
        0x80 | (length >> 8),
        length & 0xFF
      ]);
    } else if (length < 0x200000) {
      return new Uint8Array([
        0xC0 | (length >> 16),
        (length >> 8) & 0xFF,
        length & 0xFF
      ]);
    } else if (length < 0x10000000) {
      return new Uint8Array([
        0xE0 | (length >> 24),
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF
      ]);
    } else {
      return new Uint8Array([
        0xF0,
        (length >> 24) & 0xFF,
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF
      ]);
    }
  }

  private async sendCommand(words: string[]) {
    if (!this.conn) throw new Error('Not connected');

    for (const word of words) {
      const wordBytes = new TextEncoder().encode(word);
      const lengthBytes = this.encodeLength(wordBytes.length);
      
      await this.conn.write(lengthBytes);
      await this.conn.write(wordBytes);
    }
    
    await this.conn.write(new Uint8Array([0]));
  }

  private decodeLength(data: Uint8Array, offset: number): { length: number; bytesRead: number } {
    const firstByte = data[offset];
    
    if ((firstByte & 0x80) === 0) {
      return { length: firstByte, bytesRead: 1 };
    } else if ((firstByte & 0xC0) === 0x80) {
      return { 
        length: ((firstByte & 0x3F) << 8) | data[offset + 1],
        bytesRead: 2
      };
    } else if ((firstByte & 0xE0) === 0xC0) {
      return {
        length: ((firstByte & 0x1F) << 16) | (data[offset + 1] << 8) | data[offset + 2],
        bytesRead: 3
      };
    } else if ((firstByte & 0xF0) === 0xE0) {
      return {
        length: ((firstByte & 0x0F) << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3],
        bytesRead: 4
      };
    } else {
      return {
        length: (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4],
        bytesRead: 5
      };
    }
  }

  private async readResponse(): Promise<{ type: string; data: Record<string, string> }> {
    if (!this.conn) throw new Error('Not connected');

    const readExact = async (n: number): Promise<Uint8Array> => {
      if (!this.conn) throw new Error('Not connected');
      const buf = new Uint8Array(n);
      let readTotal = 0;
      
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Read timeout after 45 seconds')), 45000)
      );
      
      while (readTotal < n) {
        const chunk = await Promise.race([
          this.conn.read(buf.subarray(readTotal)),
          timeoutPromise
        ]);
        if (chunk === null) throw new Error('Connection closed');
        readTotal += chunk;
      }
      return buf;
    };

    const readLengthPrefix = async (): Promise<number> => {
      const first = await readExact(1);
      const fb = first[0];
      let needed = 1;
      if ((fb & 0x80) === 0) needed = 1;
      else if ((fb & 0xC0) === 0x80) needed = 2;
      else if ((fb & 0xE0) === 0xC0) needed = 3;
      else if ((fb & 0xF0) === 0xE0) needed = 4;
      else needed = 5;

      let raw = first;
      if (needed > 1) {
        const rest = await readExact(needed - 1);
        raw = new Uint8Array(needed);
        raw.set(first, 0);
        raw.set(rest, 1);
      }
      const { length } = this.decodeLength(raw, 0);
      return length;
    };

    const result: Record<string, string> = {};
    let type = '';

    while (true) {
      const length = await readLengthPrefix();
      if (length === 0) break;

      const wordBuffer = await readExact(length);
      const word = new TextDecoder().decode(wordBuffer);

      if (word.startsWith('!')) {
        type = word;
      } else if (word.startsWith('=')) {
        const [key, ...valueParts] = word.substring(1).split('=');
        result[key] = valueParts.join('=');
      }
    }

    return { type, data: result };
  }

  async executeCommand(command: string, params: Record<string, string> = {}): Promise<any[]> {
    const words = [command];
    
    for (const [key, value] of Object.entries(params)) {
      words.push(`=${key}=${value}`);
    }

    await this.sendCommand(words);

    const results: any[] = [];
    while (true) {
      const response = await this.readResponse();
      
      if (response.type === '!done') {
        break;
      } else if (response.type === '!re') {
        results.push(response.data);
      } else if (response.type === '!trap') {
        throw new Error(response.data.message || 'Command failed');
      }
    }

    return results;
  }

  close() {
    if (this.conn) {
      try {
        this.conn.close();
      } catch (error) {
        console.error('Error closing connection:', error);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let api: MikroTikAPI | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado - Token requerido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Extract JWT token from header
    const token = authHeader.replace('Bearer ', '');
    
    // Use service role client to verify the JWT and get user
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    const { data: { user }, error: authError } = await serviceSupabase.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado - Sesión inválida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { mikrotikId, command, params } = await req.json();

    if (!mikrotikId) {
      return new Response(
        JSON.stringify({ success: false, error: 'mikrotikId es requerido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`User ${user.id} - Command: ${command} on device ${mikrotikId}`);

    const accessCheck = await verifyUserAccess(serviceSupabase, user.id, mikrotikId);
    if (!accessCheck.authorized) {
      console.error(`Access denied for user ${user.id} to device ${mikrotikId}`);
      return new Response(
        JSON.stringify({ success: false, error: accessCheck.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const credentials = await getDeviceCredentials(serviceSupabase, mikrotikId);
    if (!credentials) {
      return new Response(
        JSON.stringify({ success: false, error: 'Dispositivo no encontrado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    const useTls = credentials.port === 8729;
    const actualPort = credentials.port || (useTls ? 8729 : 8728);

    console.log(`Connecting to MikroTik v6 at ${credentials.host}:${actualPort}`);

    api = new MikroTikAPI();
    await api.connect(credentials.host, actualPort, credentials.username, credentials.password, useTls);

    console.log('Connected successfully, executing command:', command);

    let result;
    
    switch (command) {
      case 'system-resource':
        result = await api.executeCommand('/system/resource/print');
        break;

      case 'hotspot-users':
        result = await api.executeCommand('/ip/hotspot/user/print');
        break;

      case 'hotspot-active':
        result = await api.executeCommand('/ip/hotspot/active/print');
        break;

      case 'interfaces':
        result = await api.executeCommand('/interface/print');
        break;

      case 'ppp':
        result = await api.executeCommand('/interface/ppp-client/print');
        break;

      case 'hotspot-user-add':
        result = await api.executeCommand('/ip/hotspot/user/add', params);
        break;

      case 'hotspot-user-remove':
        result = await api.executeCommand('/ip/hotspot/user/remove', params);
        break;

      case 'ppp-secrets':
        result = await api.executeCommand('/ppp/secret/print');
        break;

      case 'ppp-secret-add':
        result = await api.executeCommand('/ppp/secret/add', params);
        break;

      case 'ppp-secret-remove': {
        // First find the secret by name to get the .id
        const secrets = await api.executeCommand('/ppp/secret/print');
        const secret = secrets.find((s: any) => s.name === params.name);
        if (secret && secret['.id']) {
          result = await api.executeCommand('/ppp/secret/remove', { '.id': secret['.id'] });
        } else {
          throw new Error(`PPPoE secret "${params.name}" not found`);
        }
        break;
      }

      case 'ppp-secret-disable':
        result = await api.executeCommand('/ppp/secret/disable', params);
        break;

      case 'ppp-secret-enable':
        result = await api.executeCommand('/ppp/secret/enable', params);
        break;

      case 'ppp-active':
        result = await api.executeCommand('/ppp/active/print');
        break;

      case 'ppp-active-remove':
        result = await api.executeCommand('/ppp/active/remove', params);
        break;

      case 'address-list-print':
        result = await api.executeCommand('/ip/firewall/address-list/print');
        break;

      case 'address-list-add':
        result = await api.executeCommand('/ip/firewall/address-list/add', params);
        break;

      case 'address-list-remove':
        result = await api.executeCommand('/ip/firewall/address-list/remove', params);
        break;

      case 'address-list-enable':
        result = await api.executeCommand('/ip/firewall/address-list/enable', params);
        break;

      case 'address-list-disable':
        result = await api.executeCommand('/ip/firewall/address-list/disable', params);
        break;

      case 'simple-queues':
        result = await api.executeCommand('/queue/simple/print');
        break;

      case 'simple-queue-add':
        result = await api.executeCommand('/queue/simple/add', params);
        break;

      case 'simple-queue-remove': {
        // First find the queue by name to get the .id
        const queues = await api.executeCommand('/queue/simple/print');
        const queue = queues.find((q: any) => q.name === params.name);
        if (queue && queue['.id']) {
          result = await api.executeCommand('/queue/simple/remove', { '.id': queue['.id'] });
        } else {
          throw new Error(`Simple queue "${params.name}" not found`);
        }
        break;
      }

      case 'simple-queue-disable':
        result = await api.executeCommand('/queue/simple/disable', params);
        break;

      case 'simple-queue-enable':
        result = await api.executeCommand('/queue/simple/enable', params);
        break;

      case 'hotspot-profiles':
        result = await api.executeCommand('/ip/hotspot/user/profile/print');
        break;

      case 'hotspot-profile-add':
        result = await api.executeCommand('/ip/hotspot/user/profile/add', params);
        break;

      case 'hotspot-profile-delete':
        result = await api.executeCommand('/ip/hotspot/user/profile/remove', params);
        break;

      case 'pppoe-profiles':
        result = await api.executeCommand('/ppp/profile/print');
        break;

      case 'pppoe-profile-add':
        result = await api.executeCommand('/ppp/profile/add', params);
        break;

      case 'pppoe-profile-delete':
        result = await api.executeCommand('/ppp/profile/remove', params);
        break;

      default:
        result = await api.executeCommand(command, params || {});
    }

    api.close();

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in mikrotik-v6-api:', error);
    
    if (api) {
      api.close();
    }

    const errorMessage = (error as Error).message || 'Error desconocido';
    let userFriendlyError = errorMessage;

    if (errorMessage.includes('Connection refused') || errorMessage.includes('ECONNREFUSED')) {
      userFriendlyError = 'No se puede conectar al router. Verifica que:\n' +
        '1. El servicio API esté habilitado (/ip service enable api)\n' +
        '2. El puerto 8728 (o 8729) esté abierto en el firewall\n' +
        '3. La IP y puerto sean correctos';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      userFriendlyError = 'Tiempo de espera agotado. El router no responde. Verifica la conectividad de red.';
    } else if (errorMessage.includes('Login failed')) {
      userFriendlyError = 'Usuario o contraseña incorrectos.';
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: userFriendlyError,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
