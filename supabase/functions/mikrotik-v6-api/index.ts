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

    // Helpers locales para lectura robusta
    const readExact = async (n: number): Promise<Uint8Array> => {
      if (!this.conn) throw new Error('Not connected');
      const buf = new Uint8Array(n);
      let readTotal = 0;
      while (readTotal < n) {
        const chunk = await this.conn.read(buf.subarray(readTotal));
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
      if (length === 0) break; // Fin de la sentencia

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

    const errorMessage = (error as Error).message || 'Error desconocido';
    let userFriendlyError = errorMessage;

    // Mensajes más descriptivos para errores comunes
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
