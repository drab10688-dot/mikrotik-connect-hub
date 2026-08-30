/** Contenido editable de la página de inicio (publicidad) por ISP. */
export interface LandingFeature {
  title: string;
  text: string;
}

export interface LandingMetric {
  value: string;
  label: string;
}

export interface LandingContent {
  badge: string;
  headline: string;
  highlight: string;
  subheadline: string;
  cta: string;
  features: LandingFeature[];
  metrics: LandingMetric[];
}

export const DEFAULT_LANDING: LandingContent = {
  badge: 'Plataforma ACS TR-069',
  headline: 'La consola que tu ISP',
  highlight: 'necesita',
  subheadline:
    'ONUs, antenas y MikroTik en un solo panel. Diagnóstico en segundos, cambios masivos sin desplazamientos y control total por operador.',
  cta: 'Iniciar sesión',
  features: [
    { title: 'ONUs en vivo', text: 'Señal óptica, estado e inventario TR-069 en tiempo real.' },
    { title: 'Mapa de red', text: 'Topología MikroTik → sector → AP → cliente con calidad de enlace.' },
    { title: 'Wi-Fi y PPPoE', text: 'Cambia SSID, claves y credenciales sin entrar equipo por equipo.' },
    { title: 'Soporte ágil', text: 'Historial de eventos, alertas y acciones auditadas por operador.' },
  ],
  metrics: [
    { value: '24/7', label: 'Monitoreo' },
    { value: '<1s', label: 'Respuesta ACS' },
    { value: '12+', label: 'Marcas ONU' },
  ],
};

/** Mezcla el contenido guardado con los valores por defecto. */
export function mergeLanding(raw: any): LandingContent {
  const src = raw && typeof raw === 'object' ? raw : {};
  const features = Array.isArray(src.features) && src.features.length
    ? src.features.slice(0, 4).map((f: any, i: number) => ({
        title: String(f?.title ?? DEFAULT_LANDING.features[i]?.title ?? ''),
        text: String(f?.text ?? DEFAULT_LANDING.features[i]?.text ?? ''),
      }))
    : DEFAULT_LANDING.features;
  const metrics = Array.isArray(src.metrics) && src.metrics.length
    ? src.metrics.slice(0, 3).map((m: any, i: number) => ({
        value: String(m?.value ?? DEFAULT_LANDING.metrics[i]?.value ?? ''),
        label: String(m?.label ?? DEFAULT_LANDING.metrics[i]?.label ?? ''),
      }))
    : DEFAULT_LANDING.metrics;

  return {
    badge: src.badge || DEFAULT_LANDING.badge,
    headline: src.headline || DEFAULT_LANDING.headline,
    highlight: src.highlight ?? DEFAULT_LANDING.highlight,
    subheadline: src.subheadline || DEFAULT_LANDING.subheadline,
    cta: src.cta || DEFAULT_LANDING.cta,
    features,
    metrics,
  };
}
