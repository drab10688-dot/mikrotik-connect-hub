import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Map, Settings, MapPin, Save, Eye, EyeOff, Server } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface MikrotikDevice {
  id: string;
  name: string;
  host: string;
  latitude: string | null;
  longitude: string | null;
  status: string;
}

export function MikrotikMapView() {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [savedApiKey, setSavedApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [devices, setDevices] = useState<MikrotikDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapTab, setMapTab] = useState('map');

  useEffect(() => {
    const stored = localStorage.getItem('google_maps_api_key');
    if (stored) {
      setApiKey(stored);
      setSavedApiKey(stored);
    }
    fetchDevices();
  }, [user]);

  const fetchDevices = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('id, name, host, latitude, longitude, status')
        .eq('status', 'active');
      if (error) throw error;
      setDevices(data || []);
    } catch (err: any) {
      console.error('Error fetching devices:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveKey = () => {
    if (!apiKey.trim()) {
      toast.error('Ingresa una API Key válida');
      return;
    }
    localStorage.setItem('google_maps_api_key', apiKey.trim());
    setSavedApiKey(apiKey.trim());
    toast.success('API Key de Google Maps guardada');
  };

  const handleRemoveKey = () => {
    localStorage.removeItem('google_maps_api_key');
    setApiKey('');
    setSavedApiKey('');
    toast.success('API Key eliminada');
  };

  const devicesWithCoords = devices.filter(d => d.latitude && d.longitude);

  const getMapUrl = () => {
    if (!savedApiKey || devicesWithCoords.length === 0) return '';

    const markers = devicesWithCoords
      .map(d => `markers=color:red%7Clabel:${encodeURIComponent(d.name.charAt(0))}%7C${d.latitude},${d.longitude}`)
      .join('&');

    const center = devicesWithCoords.length === 1
      ? `${devicesWithCoords[0].latitude},${devicesWithCoords[0].longitude}`
      : `${devicesWithCoords[0].latitude},${devicesWithCoords[0].longitude}`;

    const zoom = devicesWithCoords.length === 1 ? 14 : 10;

    return `https://www.google.com/maps/embed/v1/place?key=${savedApiKey}&q=${center}&zoom=${zoom}`;
  };

  const getJsMapSrc = () => {
    if (!savedApiKey) return '';
    return `https://maps.googleapis.com/maps/api/js?key=${savedApiKey}&callback=initMap`;
  };

  return (
    <div className="space-y-6">
      {/* Config Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Configuración de Google Maps</CardTitle>
          </div>
          <CardDescription>
            Configura tu API Key de Google Maps para visualizar la ubicación de tus MikroTik en un mapa interactivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gmap-key">API Key de Google Maps</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="gmap-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button onClick={handleSaveKey} className="gap-2">
                <Save className="h-4 w-4" />
                Guardar
              </Button>
            </div>
            {savedApiKey && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="default" className="gap-1">
                  <Map className="h-3 w-3" />
                  API Key configurada
                </Badge>
                <Button variant="ghost" size="sm" className="text-destructive text-xs" onClick={handleRemoveKey}>
                  Eliminar
                </Button>
              </div>
            )}
          </div>
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground space-y-1">
            <p className="font-medium">¿Cómo obtener la API Key?</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Ve a <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console</a></li>
              <li>Crea un proyecto o selecciona uno existente</li>
              <li>Habilita la API "Maps JavaScript API" y "Maps Embed API"</li>
              <li>Crea una credencial de tipo "API Key"</li>
              <li>Copia y pega la key aquí</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Map Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Map className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Mapa de Sectores MikroTik</CardTitle>
            </div>
            <Badge variant="secondary">{devicesWithCoords.length} con ubicación</Badge>
          </div>
          <CardDescription>
            Visualiza la ubicación geográfica de tus dispositivos MikroTik
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!savedApiKey ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border rounded-lg border-dashed">
              <Map className="h-16 w-16 mb-4 opacity-30" />
              <p className="font-medium">API Key no configurada</p>
              <p className="text-sm">Configura tu API Key de Google Maps arriba para ver el mapa</p>
            </div>
          ) : devicesWithCoords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border rounded-lg border-dashed">
              <MapPin className="h-16 w-16 mb-4 opacity-30" />
              <p className="font-medium">Sin dispositivos con coordenadas</p>
              <p className="text-sm">Agrega latitud y longitud a tus MikroTik en Ajustes → Dispositivos</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border" style={{ height: '450px' }}>
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps/embed/v1/view?key=${savedApiKey}&center=${devicesWithCoords[0].latitude},${devicesWithCoords[0].longitude}&zoom=${devicesWithCoords.length === 1 ? 14 : 8}&maptype=roadmap`}
                />
              </div>

              {/* Device List with coords */}
              <div className="grid gap-2">
                <p className="text-sm font-medium text-muted-foreground">Dispositivos en el mapa:</p>
                {devicesWithCoords.map((device) => (
                  <div key={device.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <Server className="h-4 w-4 text-primary" />
                      <div>
                        <p className="font-medium text-sm">{device.name}</p>
                        <p className="text-xs text-muted-foreground">{device.host}</p>
                      </div>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${device.latitude},${device.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <MapPin className="h-3 w-3" />
                      {Number(device.latitude).toFixed(4)}, {Number(device.longitude).toFixed(4)}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
