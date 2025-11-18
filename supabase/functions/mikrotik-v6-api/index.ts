const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class MikroTikAPI {
  private conn: Deno.Conn | null = null;
  private buffer: Uint8Array = new Uint8Array(0);

  async connect(host: string, port: number, username: string, password: string, useTls: boolean) {
    try {
      // Conectar vía TCP
      this.conn = useTls 
        ? await Deno.connectTls({ hostname: host, port })
        : await Deno.connect({ hostname: host, port });

      // Login process
      await this.login(username, password);
      return true;
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  private async login(username: string, password: string) {
    // Enviar comando de login sin contraseña para obtener el challenge
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
    
    // Enviar palabra vacía para terminar
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

    const result: Record<string, string> = {};
    let type = '';

    while (true) {
      // Leer tamaño de la palabra
      const lengthBuffer = new Uint8Array(5);
      await this.conn.read(lengthBuffer);
      
      const { length, bytesRead } = this.decodeLength(lengthBuffer, 0);
      
      if (length === 0) break; // Fin de la sentencia
      
      // Leer la palabra
      const wordBuffer = new Uint8Array(length);
      let totalRead = 0;
      while (totalRead < length) {
        const n = await this.conn.read(wordBuffer.subarray(totalRead));
        if (n === null) throw new Error('Connection closed');
        totalRead += n;
      }
      
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
    const { host, username, password, port, command, params } = await req.json();

    console.log(`Connecting to MikroTik v6 at ${host}:${port}`);

    const useTls = port === 8729;
    const actualPort = port || (useTls ? 8729 : 8728);

    api = new MikroTikAPI();
    await api.connect(host, actualPort, username, password, useTls);

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

      default:
        // Permitir comandos personalizados
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

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Error al ejecutar comando en MikroTik v6',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
