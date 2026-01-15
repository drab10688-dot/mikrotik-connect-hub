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

// Add to address list v6
async function addToAddressListV6(device: MikroTikDevice, listName: string, address: string, comment: string): Promise<void> {
  const api = new MikroTikAPI();
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    await api.executeCommand('/ip/firewall/address-list/add', {
      list: listName,
      address: address,
      comment: comment,
    });
  } finally {
    api.close();
  }
}

// Remove from address list v6
async function removeFromAddressListV6(device: MikroTikDevice, listName: string, address: string): Promise<void> {
  const api = new MikroTikAPI();
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    
    // Get all entries from the address list
    const allEntries = await api.executeCommand('/ip/firewall/address-list/print');
    
    // Filter entries that match our list and address
    const matchingEntries = allEntries.filter((entry: any) => 
      entry.list === listName && entry.address === address
    );
    
    // Remove each matching entry
    for (const entry of matchingEntries) {
      if (entry['.id']) {
        await api.executeCommand('/ip/firewall/address-list/remove', {
          '.id': entry['.id'],
        });
      }
    }
  } finally {
    api.close();
  }
}

// Check if firewall rules exist for blocking morosos v6
async function checkFirewallRulesV6(device: MikroTikDevice, listName: string): Promise<{ exists: boolean; rules: any[] }> {
  const api = new MikroTikAPI();
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    
    const rules = await api.executeCommand('/ip/firewall/filter/print');
    const morososRules = rules.filter((r: any) => 
      r['src-address-list'] === listName || r['dst-address-list'] === listName
    );
    
    return { exists: morososRules.length >= 2, rules: morososRules };
  } finally {
    api.close();
  }
}

// Create firewall rules for blocking morosos v6
async function createFirewallRulesV6(device: MikroTikDevice, listName: string): Promise<{ created: string[] }> {
  const api = new MikroTikAPI();
  const createdRules: string[] = [];
  
  try {
    await api.connect(device.host, device.port, device.username, device.password);
    
    // First, check existing rules
    const existingRules = await api.executeCommand('/ip/firewall/filter/print');
    const hasSrcRule = existingRules.some((r: any) => r['src-address-list'] === listName && r.action === 'drop' && r.chain === 'forward');
    const hasDstRule = existingRules.some((r: any) => r['dst-address-list'] === listName && r.action === 'drop' && r.chain === 'forward');
    
    // Create rule to drop outgoing traffic from morosos
    if (!hasSrcRule) {
      await api.executeCommand('/ip/firewall/filter/add', {
        chain: 'forward',
        'src-address-list': listName,
        action: 'drop',
        comment: `Bloquear trafico saliente - ${listName} (Auto-generado)`,
      });
      createdRules.push(`DROP forward src-address-list=${listName}`);
    }
    
    // Create rule to drop incoming traffic to morosos
    if (!hasDstRule) {
      await api.executeCommand('/ip/firewall/filter/add', {
        chain: 'forward',
        'dst-address-list': listName,
        action: 'drop',
        comment: `Bloquear trafico entrante - ${listName} (Auto-generado)`,
      });
      createdRules.push(`DROP forward dst-address-list=${listName}`);
    }
    
    return { created: createdRules };
  } finally {
    api.close();
  }
}

// Check if firewall rules exist for blocking morosos v7
async function checkFirewallRulesV7(device: MikroTikDevice, listName: string): Promise<{ exists: boolean; rules: any[] }> {
  const baseUrl = `https://${device.host}:${device.port || 443}`;
  const auth = btoa(`${device.username}:${device.password}`);
  
  const response = await fetch(`${baseUrl}/rest/ip/firewall/filter`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to get firewall rules');
  }
  
  const rules = await response.json();
  const morososRules = rules.filter((r: any) => 
    r['src-address-list'] === listName || r['dst-address-list'] === listName
  );
  
  return { exists: morososRules.length >= 2, rules: morososRules };
}

// Create firewall rules for blocking morosos v7
async function createFirewallRulesV7(device: MikroTikDevice, listName: string): Promise<{ created: string[] }> {
  const baseUrl = `https://${device.host}:${device.port || 443}`;
  const auth = btoa(`${device.username}:${device.password}`);
  const createdRules: string[] = [];
  
  // First, check existing rules
  const checkResponse = await fetch(`${baseUrl}/rest/ip/firewall/filter`, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}` },
  });
  
  const existingRules = await checkResponse.json();
  const hasSrcRule = existingRules.some((r: any) => r['src-address-list'] === listName && r.action === 'drop' && r.chain === 'forward');
  const hasDstRule = existingRules.some((r: any) => r['dst-address-list'] === listName && r.action === 'drop' && r.chain === 'forward');
  
  // Create rule to drop outgoing traffic from morosos
  if (!hasSrcRule) {
    const srcResponse = await fetch(`${baseUrl}/rest/ip/firewall/filter`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chain: 'forward',
        'src-address-list': listName,
        action: 'drop',
        comment: `Bloquear trafico saliente - ${listName} (Auto-generado)`,
      }),
    });
    
    if (srcResponse.ok) {
      createdRules.push(`DROP forward src-address-list=${listName}`);
    }
  }
  
  // Create rule to drop incoming traffic to morosos
  if (!hasDstRule) {
    const dstResponse = await fetch(`${baseUrl}/rest/ip/firewall/filter`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chain: 'forward',
        'dst-address-list': listName,
        action: 'drop',
        comment: `Bloquear trafico entrante - ${listName} (Auto-generado)`,
      }),
    });
    
    if (dstResponse.ok) {
      createdRules.push(`DROP forward dst-address-list=${listName}`);
    }
  }
  
  return { created: createdRules };
}

// REST API functions for v7
async function addToAddressListV7(device: MikroTikDevice, listName: string, address: string, comment: string): Promise<void> {
  const baseUrl = `https://${device.host}:${device.port || 443}`;
  const auth = btoa(`${device.username}:${device.password}`);
  
  const response = await fetch(`${baseUrl}/rest/ip/firewall/address-list`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      list: listName,
      address: address,
      comment: comment,
    }),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add to address list: ${text}`);
  }
}

async function removeFromAddressListV7(device: MikroTikDevice, listName: string, address: string): Promise<void> {
  const baseUrl = `https://${device.host}:${device.port || 443}`;
  const auth = btoa(`${device.username}:${device.password}`);
  
  // First find the entry
  const listResponse = await fetch(`${baseUrl}/rest/ip/firewall/address-list?list=${listName}&address=${address}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });
  
  if (!listResponse.ok) {
    throw new Error('Failed to get address list');
  }
  
  const entries = await listResponse.json();
  
  // Remove each matching entry
  for (const entry of entries) {
    if (entry['.id']) {
      const deleteResponse = await fetch(`${baseUrl}/rest/ip/firewall/address-list/${entry['.id']}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });
      
      if (!deleteResponse.ok) {
        console.warn(`Failed to delete entry ${entry['.id']}`);
      }
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for service role call or user auth
    const authHeader = req.headers.get('Authorization');
    let isServiceCall = false;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      // Check if it's a service role key call (for internal use)
      if (token === supabaseKey) {
        isServiceCall = true;
      } else {
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) {
          return new Response(JSON.stringify({ success: false, error: 'Usuario no válido' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const { mikrotikId, action, listName, address, comment, clientId } = await req.json();
    
    if (!mikrotikId || !action) {
      return new Response(JSON.stringify({ success: false, error: 'mikrotikId y action requeridos' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const device = await getDeviceCredentials(supabase, mikrotikId);
    if (!device) {
      return new Response(JSON.stringify({ success: false, error: 'Dispositivo no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isV7 = device.version === 'v7';
    const targetList = listName || 'morosos';

    console.log(`Action: ${action}, List: ${targetList}, Address: ${address}, Device: ${device.host}, Version: ${device.version}`);

    switch (action) {
      case 'add': {
        if (!address) {
          return new Response(JSON.stringify({ success: false, error: 'address requerido' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        const entryComment = comment || `Suspendido: ${new Date().toISOString()}`;
        
        if (isV7) {
          await addToAddressListV7(device, targetList, address, entryComment);
        } else {
          await addToAddressListV6(device, targetList, address, entryComment);
        }

        // Update client billing settings if clientId provided
        if (clientId) {
          await supabase
            .from('client_billing_settings')
            .upsert({
              client_id: clientId,
              mikrotik_id: mikrotikId,
              is_suspended: true,
              suspended_at: new Date().toISOString(),
              monthly_amount: 0,
            }, { onConflict: 'client_id' });
        }

        console.log(`Successfully added ${address} to ${targetList}`);
        return new Response(JSON.stringify({ success: true, message: 'IP agregada a la lista' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'remove': {
        if (!address) {
          return new Response(JSON.stringify({ success: false, error: 'address requerido' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        if (isV7) {
          await removeFromAddressListV7(device, targetList, address);
        } else {
          await removeFromAddressListV6(device, targetList, address);
        }

        // Update client billing settings if clientId provided
        if (clientId) {
          await supabase
            .from('client_billing_settings')
            .update({
              is_suspended: false,
              suspended_at: null,
              last_payment_date: new Date().toISOString().split('T')[0],
            })
            .eq('client_id', clientId);
        }

        console.log(`Successfully removed ${address} from ${targetList}`);
        return new Response(JSON.stringify({ success: true, message: 'IP eliminada de la lista' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check-firewall': {
        // Check if firewall rules exist for the address list
        let result;
        if (isV7) {
          result = await checkFirewallRulesV7(device, targetList);
        } else {
          result = await checkFirewallRulesV6(device, targetList);
        }
        
        console.log(`Firewall rules check for ${targetList}: exists=${result.exists}`);
        return new Response(JSON.stringify({ 
          success: true, 
          exists: result.exists, 
          rules: result.rules,
          message: result.exists 
            ? `Las reglas de firewall para "${targetList}" ya existen` 
            : `No se encontraron reglas de firewall para "${targetList}"`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'create-firewall': {
        // Create firewall rules to block the address list
        let result;
        if (isV7) {
          result = await createFirewallRulesV7(device, targetList);
        } else {
          result = await createFirewallRulesV6(device, targetList);
        }
        
        console.log(`Created firewall rules for ${targetList}:`, result.created);
        return new Response(JSON.stringify({ 
          success: true, 
          created: result.created,
          message: result.created.length > 0 
            ? `Se crearon ${result.created.length} regla(s) de firewall` 
            : 'Las reglas ya existían, no se crearon nuevas'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Acción no válida' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
