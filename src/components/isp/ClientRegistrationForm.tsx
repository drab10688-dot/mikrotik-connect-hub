import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { MapPin, UserPlus, AlertCircle, Gauge, Cable } from "lucide-react";
import { PlanPricesManager } from "./PlanPricesManager";
import { ServicePricesManager } from "./ServicePricesManager";
import { useServiceOptions, ServiceOption } from "@/hooks/useServiceOptions";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clientsApi } from "@/lib/api-client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { usePPPoEProfiles } from "@/hooks/useMikrotikData";

interface ClientFormData {
  nombre: string;
  apellidos: string;
  clientePotencial: boolean;
  numeroIdentificacion: string;
  numeroCajaNap: string;
  numeroPuertoCajaNap: string;
  plan: string;
  precio: string;
  opcionTv: string;
  precioServicioAdicional: string;
  precioTotal: string;
  correoElectronico: string;
  telefono: string;
  telegramChatId: string;
  calle: string;
  calle2: string;
  ciudad: string;
  codigoPostal: string;
  pais: string;
  latitud: string;
  longitud: string;
  uploadSpeed: string;
  downloadSpeed: string;
}

export interface RegisteredClientData {
  clientName: string;
  identification: string;
  address: string;
  phone: string;
  email: string;
  plan: string;
  speed: string;
  price: string;
  serviceOption: string;
  servicePrice: string;
  totalPrice: string;
}

interface ClientRegistrationFormProps {
  onSuccess?: () => void;
  onClientRegistered?: (data: RegisteredClientData) => void;
  useStandardPassword: boolean;
  standardPassword: string;
}

export function ClientRegistrationForm({ onSuccess, onClientRegistered, useStandardPassword, standardPassword }: ClientRegistrationFormProps) {
  const queryClient = useQueryClient();
  const mikrotikId = getSelectedDeviceId();
  const { data: pppoeProfilesData, isLoading: loadingProfiles } = usePPPoEProfiles();
  const pppoeProfiles = (pppoeProfilesData as any[]) || [];
  
  const { services: serviceOptions, loading: loadingServices } = useServiceOptions(mikrotikId);

  const [useSimpleQueues, setUseSimpleQueues] = useState(false);
  const [pricesVersion, setPricesVersion] = useState(0);

  const getSpeedPrices = (): Record<string, string> => {
    const saved = localStorage.getItem("isp_speed_prices");
    return saved ? JSON.parse(saved) : {};
  };

  const getPlanPrices = (): Record<string, string> => {
    const saved = localStorage.getItem("isp_plan_prices");
    return saved ? JSON.parse(saved) : {};
  };

  const availableSpeeds = ['1M', '2M', '3M', '4M', '5M', '6M', '8M', '10M', '15M', '20M', '25M', '30M', '50M', '100M'];

  const [formData, setFormData] = useState<ClientFormData>({
    nombre: "", apellidos: "", clientePotencial: false, numeroIdentificacion: "",
    numeroCajaNap: "", numeroPuertoCajaNap: "", plan: "", precio: "",
    opcionTv: "solo-internet", precioServicioAdicional: "0", precioTotal: "",
    correoElectronico: "", telefono: "", telegramChatId: "",
    calle: "", calle2: "", ciudad: "", codigoPostal: "", pais: "Colombia",
    latitud: "", longitud: "", uploadSpeed: "10M", downloadSpeed: "10M",
  });

  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const getServicePriceByName = (serviceName: string): number => {
    const service = serviceOptions.find(s => s.name === serviceName);
    return service?.price || 0;
  };

  const calculateTotal = (precioBase: string, serviceName: string): string => {
    const servicePrice = getServicePriceByName(serviceName);
    const cleanPrice = (price: string): number => {
      const num = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", "."));
      return isNaN(num) ? 0 : num;
    };
    const baseNum = cleanPrice(precioBase);
    const total = baseNum + servicePrice;
    return total > 0 ? `$${total.toLocaleString('es-CO')}` : "";
  };

  const updateField = (field: keyof ClientFormData, value: string | boolean) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      if (field === "downloadSpeed" && typeof value === "string") {
        const savedPrice = getSpeedPrices()[value];
        if (savedPrice) { updated.precio = savedPrice; updated.precioTotal = calculateTotal(savedPrice, updated.opcionTv); }
      }
      
      if (field === "plan" && typeof value === "string") {
        const savedPrice = getPlanPrices()[value];
        if (savedPrice) { updated.precio = savedPrice; updated.precioTotal = calculateTotal(savedPrice, updated.opcionTv); }
      }

      if (field === "opcionTv" && typeof value === "string") {
        const servicePrice = getServicePriceByName(value);
        updated.precioServicioAdicional = servicePrice.toString();
        updated.precioTotal = calculateTotal(updated.precio, value);
      }

      if (field === "precio" && typeof value === "string") {
        updated.precioTotal = calculateTotal(value, updated.opcionTv);
      }
      
      return updated;
    });
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) { toast.error("Geolocalización no soportada en este navegador"); return; }
    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({ ...prev, latitud: position.coords.latitude.toFixed(6), longitud: position.coords.longitude.toFixed(6) }));
        toast.success("Ubicación obtenida correctamente");
        setIsGettingLocation(false);
      },
      (error) => { toast.error("No se pudo obtener la ubicación: " + error.message); setIsGettingLocation(false); }
    );
  };

  const formatUsernameForMikrotik = (nombre: string, apellidos: string): string => {
    const sanitizeWord = (word: string): string => {
      return word.replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I').replace(/Ó/g, 'O').replace(/Ú/g, 'U').replace(/Ü/g, 'U').replace(/[^a-zA-Z]/g, '');
    };
    const capitalize = (word: string): string => { if (!word) return ''; return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); };
    const fullName = `${nombre} ${apellidos}`.trim();
    const words = fullName.split(/\s+/).filter(w => w.length > 0);
    const formattedParts = words.map(word => capitalize(sanitizeWord(word))).filter(w => w.length > 0);
    return formattedParts.join('.');
  };

  const resetFormData = () => {
    setFormData({
      nombre: "", apellidos: "", clientePotencial: false, numeroIdentificacion: "",
      numeroCajaNap: "", numeroPuertoCajaNap: "", plan: "", precio: "",
      opcionTv: "solo-internet", precioServicioAdicional: "0", precioTotal: "",
      correoElectronico: "", telefono: "", telegramChatId: "",
      calle: "", calle2: "", ciudad: "", codigoPostal: "", pais: "Colombia",
      latitud: "", longitud: "", uploadSpeed: "10M", downloadSpeed: "10M",
    });
  };

  const createClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const username = formatUsernameForMikrotik(data.nombre, data.apellidos);
      
      const parsePrice = (price: string): number => {
        const num = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", "."));
        return isNaN(num) ? 0 : num;
      };
      
      const basePrice = parsePrice(data.precio);
      const servicePrice = parsePrice(data.precioServicioAdicional);
      const totalPrice = basePrice + servicePrice;

      // Call the unified register endpoint that handles MikroTik + DB
      const result = await clientsApi.register({
        mikrotik_id: mikrotikId,
        use_simple_queues: useSimpleQueues,
        username,
        password: useStandardPassword ? standardPassword : undefined,
        plan: data.plan || undefined,
        upload_speed: data.uploadSpeed,
        download_speed: data.downloadSpeed,
        client_name: `${data.nombre} ${data.apellidos}`,
        identification_number: data.numeroIdentificacion,
        phone: data.telefono,
        email: data.correoElectronico,
        telegram_chat_id: data.telegramChatId || null,
        address: `${data.calle}${data.calle2 ? ', ' + data.calle2 : ''}`,
        city: data.ciudad,
        latitude: data.latitud,
        longitude: data.longitud,
        is_potential_client: data.clientePotencial,
        comment: data.numeroCajaNap ? `NAP: ${data.numeroCajaNap}-${data.numeroPuertoCajaNap}` : null,
        service_option: data.opcionTv || null,
        service_price: servicePrice,
        total_monthly_price: totalPrice > 0 ? totalPrice : basePrice,
        nap_box: data.numeroCajaNap,
        nap_port: data.numeroPuertoCajaNap,
      });

      return result;
    },
    onSuccess: (result) => {
      const isPPPoE = result.type === 'pppoe';
      const message = isPPPoE 
        ? `🌐 *Datos de conexión PPPoE*\n\n👤 Cliente: ${result.clientName}\n📧 Usuario: ${result.username}\n🔑 Contraseña: ${result.password}\n🌍 IP Asignada: ${result.remoteIP}\n\n¡Gracias por confiar en nosotros!`
        : `🌐 *Datos de conexión*\n\n👤 Cliente: ${result.clientName}\n📧 Nombre: ${result.username}\n🌍 IP Asignada: ${result.remoteIP}\n⚡ Velocidad: ${result.speed}\n\n¡Gracias por confiar en nosotros!`;
      
      const copyToClipboard = () => { copyTextToClipboard(message.replace(/\*/g, '')).then(ok => ok ? toast.success("Copiado al portapapeles") : toast.error("No se pudo copiar")); };
      const shareWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank'); };

      // Show MikroTik warning if creation failed
      if (result.mikrotikCreated === false && result.mikrotikError) {
        toast.error(
          <div className="space-y-2">
            <p className="font-semibold">⚠️ Cliente guardado pero NO creado en MikroTik</p>
            <p className="text-sm">{result.mikrotikError}</p>
            <p className="text-xs text-muted-foreground">Verifica la conexión con el router y créalo manualmente si es necesario.</p>
          </div>,
          { duration: 15000 }
        );
      }

      toast.success(
        <div className="space-y-3">
          <p className="font-semibold">
            {result.mikrotikCreated === false 
              ? `⚠️ Cliente registrado en DB (sin MikroTik)` 
              : `✅ Cliente registrado exitosamente (${isPPPoE ? 'PPPoE' : 'Simple Queue'})`}
          </p>
          <div className="text-sm space-y-1 bg-muted p-2 rounded">
            <p><strong>Cliente:</strong> {result.clientName}</p>
            <p><strong>{isPPPoE ? 'Usuario' : 'Nombre'}:</strong> {result.username}</p>
            {isPPPoE && <p><strong>Contraseña:</strong> {result.password}</p>}
            <p><strong>IP:</strong> {result.remoteIP}</p>
            {!isPPPoE && <p><strong>Velocidad:</strong> {result.speed}</p>}
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={copyToClipboard} className="flex-1 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90">📋 Copiar</button>
            <button onClick={shareWhatsApp} className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700">📱 WhatsApp</button>
          </div>
        </div>,
        { duration: 30000 }
      );

      // Notify parent
      if (onClientRegistered) {
        onClientRegistered({
          clientName: result.clientName,
          identification: formData.numeroIdentificacion,
          address: `${formData.calle}${formData.calle2 ? ', ' + formData.calle2 : ''}`,
          phone: formData.telefono,
          email: formData.correoElectronico,
          plan: isPPPoE ? formData.plan : `${formData.downloadSpeed}/${formData.uploadSpeed}`,
          speed: isPPPoE ? '' : `${formData.uploadSpeed}/${formData.downloadSpeed}`,
          price: formData.precio,
          serviceOption: formData.opcionTv,
          servicePrice: formData.precioServicioAdicional,
          totalPrice: formData.precioTotal,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['isp-clients'] });
      queryClient.invalidateQueries({ queryKey: ['pppoe-users'] });
      resetFormData();
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nombre || !formData.apellidos) {
      toast.error("Nombre y apellidos son requeridos");
      return;
    }
    if (!useSimpleQueues && (!useStandardPassword || !standardPassword)) {
      toast.error("Configure una contraseña estándar antes de registrar clientes PPPoE");
      return;
    }
    createClientMutation.mutate(formData);
  };

  if (!mikrotikId) {
    return (
      <Card><CardContent className="flex items-center justify-center py-12">
        <div className="text-center"><AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><h3 className="text-lg font-medium">Sin conexión</h3><p className="text-muted-foreground">Conecta un dispositivo MikroTik desde Configuración</p></div>
      </CardContent></Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Connection type toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <Label className="text-base font-semibold">Tipo de Conexión</Label>
            <div className="flex items-center gap-4">
              {useSimpleQueues ? (
                <ServicePricesManager mikrotikId={mikrotikId} onPricesChange={() => setPricesVersion(v => v + 1)} />
              ) : (
                <PlanPricesManager plans={pppoeProfiles.map((p: any) => ({ name: p.name, rateLimit: p['rate-limit'] || '-' }))} speeds={availableSpeeds} useSimpleQueues={useSimpleQueues} onPricesChange={() => setPricesVersion(v => v + 1)} />
              )}
            </div>
          </div>

          <RadioGroup value={useSimpleQueues ? "queue" : "pppoe"} onValueChange={(val) => setUseSimpleQueues(val === "queue")} className="grid grid-cols-2 gap-4">
            <div className={`flex items-center space-x-3 border rounded-lg p-4 cursor-pointer ${!useSimpleQueues ? 'border-primary bg-primary/5' : ''}`}>
              <RadioGroupItem value="pppoe" id="pppoe" />
              <Label htmlFor="pppoe" className="cursor-pointer flex items-center gap-2"><Cable className="h-4 w-4" />PPPoE</Label>
            </div>
            <div className={`flex items-center space-x-3 border rounded-lg p-4 cursor-pointer ${useSimpleQueues ? 'border-primary bg-primary/5' : ''}`}>
              <RadioGroupItem value="queue" id="queue" />
              <Label htmlFor="queue" className="cursor-pointer flex items-center gap-2"><Gauge className="h-4 w-4" />Simple Queue</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Client info */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Nombre *</Label><Input value={formData.nombre} onChange={(e) => updateField("nombre", e.target.value)} required /></div>
            <div className="space-y-2"><Label>Apellidos *</Label><Input value={formData.apellidos} onChange={(e) => updateField("apellidos", e.target.value)} required /></div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox id="potencial" checked={formData.clientePotencial} onCheckedChange={(checked) => updateField("clientePotencial", checked === true)} />
            <Label htmlFor="potencial">Cliente potencial (no crear en MikroTik)</Label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Identificación</Label><Input value={formData.numeroIdentificacion} onChange={(e) => updateField("numeroIdentificacion", e.target.value)} /></div>
            <div className="space-y-2"><Label>Teléfono</Label><Input value={formData.telefono} onChange={(e) => updateField("telefono", e.target.value)} /></div>
            <div className="space-y-2"><Label>Correo</Label><Input type="email" value={formData.correoElectronico} onChange={(e) => updateField("correoElectronico", e.target.value)} /></div>
          </div>

          <div className="space-y-2"><Label>Telegram Chat ID</Label><Input value={formData.telegramChatId} onChange={(e) => updateField("telegramChatId", e.target.value)} placeholder="Opcional" /></div>

          {/* Plan / Speed selection */}
          {useSimpleQueues ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Velocidad de Bajada</Label>
                <Select value={formData.downloadSpeed} onValueChange={(v) => updateField("downloadSpeed", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{availableSpeeds.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-2"><Label>Velocidad de Subida</Label>
                <Select value={formData.uploadSpeed} onValueChange={(v) => updateField("uploadSpeed", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{availableSpeeds.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Plan PPPoE</Label>
              {loadingProfiles ? <p className="text-sm text-muted-foreground">Cargando perfiles...</p> : (
                <Select value={formData.plan} onValueChange={(v) => updateField("plan", v)}><SelectTrigger><SelectValue placeholder="Seleccionar plan" /></SelectTrigger>
                  <SelectContent>{pppoeProfiles.map((p: any) => <SelectItem key={p['.id'] || p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Precio Base</Label><Input value={formData.precio} onChange={(e) => updateField("precio", e.target.value)} placeholder="$0" /></div>
            <div className="space-y-2">
              <Label>Servicio Adicional</Label>
              {loadingServices ? <p className="text-sm text-muted-foreground">Cargando...</p> : (
                <Select value={formData.opcionTv} onValueChange={(v) => updateField("opcionTv", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solo-internet">Solo Internet</SelectItem>
                    {serviceOptions.map(opt => <SelectItem key={opt.id} value={opt.name}>{opt.name} - ${opt.price.toLocaleString('es-CO')}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2"><Label>Precio Total</Label><Input value={formData.precioTotal} readOnly className="font-bold" /></div>
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /><Label className="text-base font-semibold">Dirección</Label></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Calle / Dirección</Label><Input value={formData.calle} onChange={(e) => updateField("calle", e.target.value)} /></div>
            <div className="space-y-2"><Label>Complemento</Label><Input value={formData.calle2} onChange={(e) => updateField("calle2", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Ciudad</Label><Input value={formData.ciudad} onChange={(e) => updateField("ciudad", e.target.value)} /></div>
            <div className="space-y-2"><Label>Código Postal</Label><Input value={formData.codigoPostal} onChange={(e) => updateField("codigoPostal", e.target.value)} /></div>
            <div className="space-y-2"><Label>País</Label><Input value={formData.pais} onChange={(e) => updateField("pais", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>NAP / Caja</Label><Input value={formData.numeroCajaNap} onChange={(e) => updateField("numeroCajaNap", e.target.value)} /></div>
            <div className="space-y-2"><Label>Puerto NAP</Label><Input value={formData.numeroPuertoCajaNap} onChange={(e) => updateField("numeroPuertoCajaNap", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Latitud</Label><Input value={formData.latitud} onChange={(e) => updateField("latitud", e.target.value)} /></div>
            <div className="space-y-2"><Label>Longitud</Label><Input value={formData.longitud} onChange={(e) => updateField("longitud", e.target.value)} /></div>
            <div className="flex items-end">
              <Button type="button" variant="outline" onClick={handleGetLocation} disabled={isGettingLocation}>
                <MapPin className="h-4 w-4 mr-2" />{isGettingLocation ? "Obteniendo..." : "Obtener GPS"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={createClientMutation.isPending}>
        <UserPlus className="h-4 w-4 mr-2" />
        {createClientMutation.isPending ? "Registrando..." : "Registrar Cliente"}
      </Button>
    </form>
  );
}
