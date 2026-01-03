// Shared security utilities for edge functions

/**
 * Check if an IP address is private/internal (SSRF prevention)
 * Blocks access to cloud metadata endpoints, localhost, and private networks
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  // Remove any protocol prefix and port if present
  const cleanIP = ip.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  
  const privatePatterns = [
    // IPv4 private ranges
    /^10\./,                           // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
    /^192\.168\./,                     // 192.168.0.0/16
    /^127\./,                          // 127.0.0.0/8 (loopback)
    /^0\./,                            // 0.0.0.0/8
    /^169\.254\./,                     // 169.254.0.0/16 (link-local, AWS/GCP metadata)
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
    
    // IPv6 patterns
    /^::1$/,                           // Loopback
    /^fc00:/i,                         // Unique local
    /^fd[0-9a-f]{2}:/i,               // Unique local
    /^fe80:/i,                         // Link-local
    /^::ffff:127\./i,                  // IPv4-mapped loopback
    /^::ffff:10\./i,                   // IPv4-mapped private
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:169\.254\./i,
    
    // Special hostnames
    /^localhost$/i,
    /^.*\.localhost$/i,
    /^.*\.local$/i,
    /^metadata\.google\.internal$/i,
  ];
  
  return privatePatterns.some(pattern => pattern.test(cleanIP));
}

/**
 * Validate a host parameter for SSRF prevention
 * Returns an error message if the host is invalid, null if valid
 */
export function validateHost(host: string | undefined | null): string | null {
  if (!host) {
    return 'Host es requerido';
  }
  
  if (typeof host !== 'string') {
    return 'Host debe ser una cadena de texto';
  }
  
  const trimmedHost = host.trim();
  
  if (trimmedHost.length === 0) {
    return 'Host no puede estar vacío';
  }
  
  if (trimmedHost.length > 255) {
    return 'Host excede la longitud máxima permitida';
  }
  
  if (isPrivateOrReservedIP(trimmedHost)) {
    return 'Acceso a direcciones IP privadas o reservadas no está permitido';
  }
  
  return null;
}

/**
 * Validate port number
 */
export function validatePort(port: number | undefined | null): string | null {
  if (port === undefined || port === null) {
    return null; // Port is optional in most cases
  }
  
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return 'Puerto debe ser un número entero';
  }
  
  if (port < 1 || port > 65535) {
    return 'Puerto debe estar entre 1 y 65535';
  }
  
  return null;
}

/**
 * Validate UUID format
 */
export function validateUUID(id: string | undefined | null, fieldName: string = 'ID'): string | null {
  if (!id) {
    return `${fieldName} es requerido`;
  }
  
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!uuidPattern.test(id)) {
    return `${fieldName} tiene formato inválido`;
  }
  
  return null;
}

/**
 * Verify Wompi webhook signature
 */
export async function verifyWompiSignature(
  body: any,
  signature: string | null,
  webhookSecret: string
): Promise<boolean> {
  if (!signature || !webhookSecret) {
    console.error('Missing signature or webhook secret for Wompi verification');
    return false;
  }
  
  try {
    // Wompi signature format: properties to hash depend on the event
    // The signature is a SHA256 hash of: properties concatenated + events_secret
    const properties = body.signature?.properties || [];
    const timestamp = body.timestamp;
    
    // Build the string to hash based on the properties in the signature object
    let dataToHash = '';
    for (const prop of properties) {
      const keys = prop.split('.');
      let value = body;
      for (const key of keys) {
        value = value?.[key];
      }
      dataToHash += value;
    }
    dataToHash += timestamp + webhookSecret;
    
    // Calculate expected signature
    const encoder = new TextEncoder();
    const data = encoder.encode(dataToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const expectedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const isValid = signature === expectedSignature;
    
    if (!isValid) {
      console.error('Wompi signature mismatch');
    }
    
    return isValid;
  } catch (error) {
    console.error('Error verifying Wompi signature:', error);
    return false;
  }
}

/**
 * Verify Mercado Pago webhook signature (x-signature header)
 */
export async function verifyMercadoPagoSignature(
  dataId: string,
  xSignature: string | null,
  xRequestId: string | null,
  webhookSecret: string
): Promise<boolean> {
  if (!xSignature || !xRequestId || !webhookSecret) {
    console.error('Missing required headers or secret for Mercado Pago verification');
    return false;
  }
  
  try {
    // Parse the x-signature header (format: "ts=...,v1=...")
    const signatureParts: Record<string, string> = {};
    xSignature.split(',').forEach(part => {
      const [key, value] = part.split('=');
      if (key && value) {
        signatureParts[key.trim()] = value.trim();
      }
    });
    
    const ts = signatureParts['ts'];
    const v1 = signatureParts['v1'];
    
    if (!ts || !v1) {
      console.error('Invalid x-signature format');
      return false;
    }
    
    // Build the manifest string
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    
    // Calculate HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(manifest)
    );
    
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const isValid = v1 === expectedSignature;
    
    if (!isValid) {
      console.error('Mercado Pago signature mismatch');
    }
    
    return isValid;
  } catch (error) {
    console.error('Error verifying Mercado Pago signature:', error);
    return false;
  }
}
