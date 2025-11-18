const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { host, action, port, ports } = await req.json();

    console.log(`Network diagnostics - Action: ${action}, Host: ${host}`);

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
