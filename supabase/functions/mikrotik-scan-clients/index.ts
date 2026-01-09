import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MikroTikDevice {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  version: string;
}

interface ScannedClient {
  name: string;
  ip: string;
  type: 'pppoe' | 'queue';
  profile?: string;
  speed?: string;
  comment?: string;
  disabled?: boolean;
  mikrotikId?: string;
}

// MikroTik API for v6
class MikroTikAPI {
  private conn: Deno.Conn | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer: Uint8Array = new Uint8Array(0);

  async connect(host: string, port: number, username: string, password: string, useTls: boolean = false) {
    try {
      if (useTls) {
        this.conn = await Deno.connectTls({ hostname: host, port });
      } else {
        this.conn = await Deno.connect({ hostname: host, port });
      }
      this.reader = this.conn.readable.getReader();
      await this.login(username, password);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Connection failed: ${message}`);
    }
  }

  private async login(username: string, password: string) {
    await this.sendCommand(['/login', `=name=${username}`, `=password=${password}`]);
    const response = await this.readResponse();
    if (response.type === '!trap') {
      throw new Error('Authentication failed');
    }
  }

  private encodeLength(length: number): Uint8Array {
    if (length < 0x80) {
      return new Uint8Array([length]);
    } else if (length < 0x4000) {
      return new Uint8Array([((length >> 8) & 0x3F) | 0x80, length & 0xFF]);
    } else if (length < 0x200000) {
      return new Uint8Array([((length >> 16) & 0x1F) | 0xC0, (length >> 8) & 0xFF, length & 0xFF]);
    } else if (length < 0x10000000) {
      return new Uint8Array([((length >> 24) & 0x0F) | 0xE0, (length >> 16) & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
    } else {
      return new Uint8Array([0xF0, (length >> 24) & 0xFF, (length >> 16) & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
    }
  }

  private async sendCommand(words: string[]) {
    if (!this.conn) throw new Error('Not connected');
    
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    
    for (const word of words) {
      const wordBytes = encoder.encode(word);
      parts.push(this.encodeLength(wordBytes.length));
      parts.push(wordBytes);
    }
    parts.push(new Uint8Array([0]));
    
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      message.set(part, offset);
      offset += part.length;
    }
    
    await this.conn.write(message);
  }

  private async readBytes(count: number): Promise<Uint8Array> {
    while (this.buffer.length < count) {
      const result = await this.reader!.read();
      if (result.done) throw new Error('Connection closed');
      const newBuffer = new Uint8Array(this.buffer.length + result.value.length);
      newBuffer.set(this.buffer);
      newBuffer.set(result.value, this.buffer.length);
      this.buffer = newBuffer;
    }
    const data = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return data;
  }

  private async readLength(): Promise<number> {
    const first = (await this.readBytes(1))[0];
    if ((first & 0x80) === 0) return first;
    if ((first & 0xC0) === 0x80) {
      const second = (await this.readBytes(1))[0];
      return ((first & 0x3F) << 8) | second;
    }
    if ((first & 0xE0) === 0xC0) {
      const rest = await this.readBytes(2);
      return ((first & 0x1F) << 16) | (rest[0] << 8) | rest[1];
    }
    if ((first & 0xF0) === 0xE0) {
      const rest = await this.readBytes(3);
      return ((first & 0x0F) << 24) | (rest[0] << 16) | (rest[1] << 8) | rest[2];
    }
    const rest = await this.readBytes(4);
    return (rest[0] << 24) | (rest[1] << 16) | (rest[2] << 8) | rest[3];
  }

  private async readResponse(): Promise<{ type: string; data: Record<string, string> }> {
    const decoder = new TextDecoder();
    const data: Record<string, string> = {};
    let type = '';
    
    while (true) {
      const length = await this.readLength();
      if (length === 0) break;
      
      const wordBytes = await this.readBytes(length);
      const word = decoder.decode(wordBytes);
      
      if (word.startsWith('!')) {
        type = word;
      } else if (word.startsWith('=')) {
        const eqIndex = word.indexOf('=', 1);
        if (eqIndex !== -1) {
          const key = word.substring(1, eqIndex);
          const value = word.substring(eqIndex + 1);
          data[key] = value;
        }
      }
    }
    
    return { type, data };
  }

  async executeCommand(command: string, params: Record<string, string> = {}): Promise<any[]> {
    const words = [command];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        words.push(`=${key}=${value}`);
      }
    }
    
    await this.sendCommand(words);
    
    const results: any[] = [];
    while (true) {
      const response = await this.readResponse();
      if (response.type === '!done') break;
      if (response.type === '!trap') {
        throw new Error(response.data.message || 'Command failed');
      }
      if (response.type === '!re') {
        results.push(response.data);
      }
    }
    
    return results;
  }

  close() {
    if (this.conn) {
      try {
        this.conn.close();
      } catch (_) {}
      this.conn = null;
    }
  }
}

// Function to get device credentials
async function getDeviceCredentials(supabase: any, mikrotikId: string): Promise<MikroTikDevice | null> {
  const { data, error } = await supabase
    .from('mikrotik_devices')
    .select('id, host, username, password, port, version')
    .eq('id', mikrotikId)
    .single();
  
  if (error || !data) return null;
  return data;
}

// Scan PPPoE secrets using API v6
async function scanPPPoEv6(device: MikroTikDevice): Promise<ScannedClient[]> {
  const api = new MikroTikAPI();
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    const secrets = await api.executeCommand('/ppp/secret/print');
    
    return secrets
      .filter((s: any) => (s.service || '').toLowerCase() === 'pppoe')
      .map((s: any) => ({
        name: s.name || '',
        ip: s['remote-address'] || '',
        type: 'pppoe' as const,
        profile: s.profile || '',
        comment: s.comment || '',
        disabled: s.disabled === 'true',
        mikrotikId: s['.id'],
      }));
  } finally {
    api.close();
  }
}

// Scan Simple Queues using API v6
async function scanQueuesv6(device: MikroTikDevice): Promise<ScannedClient[]> {
  const api = new MikroTikAPI();
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    const queues = await api.executeCommand('/queue/simple/print');
    
    return queues
      .filter((q: any) => !q.dynamic || q.dynamic !== 'true')
      .map((q: any) => {
        const target = q.target || '';
        const ipMatch = target.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        return {
          name: q.name || '',
          ip: ipMatch ? ipMatch[1] : target,
          type: 'queue' as const,
          speed: q['max-limit'] || '',
          comment: q.comment || '',
          disabled: q.disabled === 'true',
          mikrotikId: q['.id'],
        };
      });
  } finally {
    api.close();
  }
}

// Scan using REST API (v7)
async function scanUsingREST(device: MikroTikDevice, endpoint: string): Promise<any[]> {
  const baseUrl = `https://${device.host}:${device.port || 443}`;
  const auth = btoa(`${device.username}:${device.password}`);
  
  const response = await fetch(`${baseUrl}/rest${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`REST API error: ${response.statusText}`);
  }
  
  return await response.json();
}

async function scanPPPoEv7(device: MikroTikDevice): Promise<ScannedClient[]> {
  const secrets = await scanUsingREST(device, '/ppp/secret');
  return secrets
    .filter((s: any) => (s.service || '').toLowerCase() === 'pppoe')
    .map((s: any) => ({
      name: s.name || '',
      ip: s['remote-address'] || '',
      type: 'pppoe' as const,
      profile: s.profile || '',
      comment: s.comment || '',
      disabled: s.disabled === true || s.disabled === 'true',
      mikrotikId: s['.id'],
    }));
}

async function scanQueuesv7(device: MikroTikDevice): Promise<ScannedClient[]> {
  const queues = await scanUsingREST(device, '/queue/simple');
  return queues
    .filter((q: any) => !q.dynamic)
    .map((q: any) => {
      const target = q.target || '';
      const ipMatch = target.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      return {
        name: q.name || '',
        ip: ipMatch ? ipMatch[1] : target,
        type: 'queue' as const,
        speed: q['max-limit'] || '',
        comment: q.comment || '',
        disabled: q.disabled === true || q.disabled === 'true',
        mikrotikId: q['.id'],
      };
    });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ success: false, error: 'Usuario no válido' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { mikrotikId, scanType } = await req.json();
    
    if (!mikrotikId) {
      return new Response(JSON.stringify({ success: false, error: 'mikrotikId requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Scanning MikroTik ${mikrotikId} for ${scanType || 'all'} clients`);

    // Get device credentials
    const device = await getDeviceCredentials(supabase, mikrotikId);
    if (!device) {
      return new Response(JSON.stringify({ success: false, error: 'Dispositivo no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing registered clients
    const { data: existingClients, error: clientsError } = await supabase
      .from('isp_clients')
      .select('id, username, assigned_ip, connection_type')
      .eq('mikrotik_id', mikrotikId);

    if (clientsError) {
      console.error('Error fetching existing clients:', clientsError);
      throw new Error('Error al obtener clientes registrados');
    }

    const existingUsernames = new Set((existingClients || []).map(c => c.username.toLowerCase()));
    const existingIPs = new Set((existingClients || []).map(c => c.assigned_ip).filter(Boolean));

    // Scan MikroTik
    let scannedClients: ScannedClient[] = [];
    const isV7 = device.version === 'v7';

    try {
      if (!scanType || scanType === 'pppoe' || scanType === 'all') {
        console.log('Scanning PPPoE secrets...');
        const pppoeClients = isV7 
          ? await scanPPPoEv7(device) 
          : await scanPPPoEv6(device);
        scannedClients = [...scannedClients, ...pppoeClients];
        console.log(`Found ${pppoeClients.length} PPPoE clients`);
      }

      if (!scanType || scanType === 'queue' || scanType === 'all') {
        console.log('Scanning Simple Queues...');
        const queueClients = isV7 
          ? await scanQueuesv7(device) 
          : await scanQueuesv6(device);
        scannedClients = [...scannedClients, ...queueClients];
        console.log(`Found ${queueClients.length} Queue clients`);
      }
    } catch (scanError: any) {
      console.error('Scan error:', scanError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Error al escanear: ${scanError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out already registered clients
    const unregisteredClients = scannedClients.filter(client => {
      const usernameExists = existingUsernames.has(client.name.toLowerCase());
      const ipExists = client.ip && existingIPs.has(client.ip);
      return !usernameExists && !ipExists && client.ip;
    });

    console.log(`Found ${unregisteredClients.length} unregistered clients out of ${scannedClients.length} total`);

    return new Response(JSON.stringify({
      success: true,
      data: {
        total: scannedClients.length,
        unregistered: unregisteredClients,
        registered: scannedClients.length - unregisteredClients.length,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
