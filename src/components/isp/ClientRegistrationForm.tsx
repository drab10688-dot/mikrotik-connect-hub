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
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  correoElectronico: string;
  telefono: string;
  calle: string;
  calle2: string;
  ciudad: string;
  codigoPostal: string;
  pais: string;
  latitud: string;
  longitud: string;
  // Campos adicionales para Simple Queues
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

  // Toggle para Simple Queues vs PPPoE
  const [useSimpleQueues, setUseSimpleQueues] = useState(false);

  // Sistema de precios guardados - versión actualizada para refrescar
  const [pricesVersion, setPricesVersion] = useState(0);

  const getSpeedPrices = (): Record<string, string> => {
    const saved = localStorage.getItem("isp_speed_prices");
    return saved ? JSON.parse(saved) : {};
  };

  const getPlanPrices = (): Record<string, string> => {
    const saved = localStorage.getItem("isp_plan_prices");
    return saved ? JSON.parse(saved) : {};
  };

  // Lista de velocidades disponibles
  const availableSpeeds = ['1M', '2M', '3M', '4M', '5M', '6M', '8M', '10M', '15M', '20M', '25M', '30M', '50M', '100M'];

  const [formData, setFormData] = useState<ClientFormData>({
    nombre: "",
    apellidos: "",
    clientePotencial: false,
    numeroIdentificacion: "",
    numeroCajaNap: "",
    numeroPuertoCajaNap: "",
    plan: "",
    precio: "",
    opcionTv: "solo-internet",
    correoElectronico: "",
    telefono: "",
    calle: "",
    calle2: "",
    ciudad: "",
    codigoPostal: "",
    pais: "Colombia",
    latitud: "",
    longitud: "",
    uploadSpeed: "10M",
    downloadSpeed: "10M",
  });

  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const updateField = (field: keyof ClientFormData, value: string | boolean) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // Auto-completar precio cuando cambia la velocidad de bajada (Simple Queues)
      if (field === "downloadSpeed" && typeof value === "string") {
        const savedPrice = getSpeedPrices()[value];
        if (savedPrice) {
          updated.precio = savedPrice;
        }
      }
      
      // Auto-completar precio cuando cambia el plan (PPPoE)
      if (field === "plan" && typeof value === "string") {
        const savedPrice = getPlanPrices()[value];
        if (savedPrice) {
          updated.precio = savedPrice;
        }
      }
      
      return updated;
    });
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalización no soportada en este navegador");
      return;
    }

    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({
          ...prev,
          latitud: position.coords.latitude.toFixed(6),
          longitud: position.coords.longitude.toFixed(6),
        }));
        toast.success("Ubicación obtenida correctamente");
        setIsGettingLocation(false);
      },
      (error) => {
        toast.error("No se pudo obtener la ubicación: " + error.message);
        setIsGettingLocation(false);
      }
    );
  };

  // Función para sanitizar y formatear nombre para MikroTik (Nombre.Apellido.Etc)
  const formatUsernameForMikrotik = (nombre: string, apellidos: string): string => {
    const sanitizeWord = (word: string): string => {
      return word
        .replace(/ñ/g, 'n')
        .replace(/Ñ/g, 'N')
        .replace(/á/g, 'a')
        .replace(/é/g, 'e')
        .replace(/í/g, 'i')
        .replace(/ó/g, 'o')
        .replace(/ú/g, 'u')
        .replace(/ü/g, 'u')
        .replace(/Á/g, 'A')
        .replace(/É/g, 'E')
        .replace(/Í/g, 'I')
        .replace(/Ó/g, 'O')
        .replace(/Ú/g, 'U')
        .replace(/Ü/g, 'U')
        .replace(/[^a-zA-Z]/g, '');
    };

    const capitalize = (word: string): string => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    };

    // Combinar nombre y apellidos, dividir por espacios
    const fullName = `${nombre} ${apellidos}`.trim();
    const words = fullName.split(/\s+/).filter(w => w.length > 0);
    
    // Sanitizar y capitalizar cada palabra, luego unir con puntos
    const formattedParts = words.map(word => capitalize(sanitizeWord(word))).filter(w => w.length > 0);
    
    return formattedParts.join('.');
  };

  // Función para convertir IP a número para comparación
  const ipToNumber = (ip: string): number => {
    const parts = ip.split('.').map(Number);
    return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3];
  };

  // Función para incrementar una IP
  const incrementIP = (ip: string): string => {
    const parts = ip.split('.').map(Number);
    parts[3]++;
    if (parts[3] > 254) {
      parts[3] = 1;
      parts[2]++;
      if (parts[2] > 255) {
        parts[2] = 0;
        parts[1]++;
      }
    }
    return parts.join('.');
  };

  // Función para obtener la siguiente IP disponible basada en usuarios PPPoE
  const getNextAvailableIPFromPPPoE = async (): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("No hay sesión activa");

    const response = await supabase.functions.invoke('mikrotik-v6-api', {
      body: {
        mikrotikId,
        command: 'ppp-secrets',
        action: 'list'
      }
    });

    if (!response.data?.success) {
      throw new Error("No se pudo obtener la lista de usuarios PPPoE");
    }

    const secrets = response.data.data || [];
    let highestIP = "";
    let highestIPValue = 0;

    secrets.forEach((secret: any) => {
      const service = (secret.service || '').toLowerCase();
      if (service !== 'pppoe') return;

      const remoteAddress = secret['remote-address'] || secret.remoteAddress || '';
      if (!remoteAddress || remoteAddress === '') return;

      const ipValue = ipToNumber(remoteAddress);
      if (ipValue > highestIPValue) {
        highestIPValue = ipValue;
        highestIP = remoteAddress;
      }
    });

    if (!highestIP) {
      throw new Error("No se encontraron usuarios PPPoE con IP remota asignada");
    }

    return incrementIP(highestIP);
  };

  // Función para obtener la siguiente IP disponible basada en Simple Queues
  const getNextAvailableIPFromQueues = async (): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("No hay sesión activa");

    const response = await supabase.functions.invoke('mikrotik-v6-api', {
      body: {
        mikrotikId,
        command: 'simple-queues',
      }
    });

    if (!response.data?.success) {
      throw new Error("No se pudo obtener la lista de Simple Queues");
    }

    const queues = response.data.data || [];
    let highestIP = "";
    let highestIPValue = 0;

    queues.forEach((queue: any) => {
      // El target puede ser una IP como "192.168.1.100/32" o "192.168.1.100"
      const target = queue.target || '';
      if (!target) return;

      // Extraer la IP del target (quitar /32 o cualquier máscara)
      const ipMatch = target.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (!ipMatch) return;

      const ip = ipMatch[1];
      const ipValue = ipToNumber(ip);
      if (ipValue > highestIPValue) {
        highestIPValue = ipValue;
        highestIP = ip;
      }
    });

    if (!highestIP) {
      throw new Error("No se encontraron Simple Queues con IP asignada. Configure al menos una cola manualmente primero.");
    }

    return incrementIP(highestIP);
  };

  const resetFormData = () => {
    setFormData({
      nombre: "",
      apellidos: "",
      clientePotencial: false,
      numeroIdentificacion: "",
      numeroCajaNap: "",
      numeroPuertoCajaNap: "",
      plan: "",
      precio: "",
      opcionTv: "solo-internet",
      correoElectronico: "",
      telefono: "",
      calle: "",
      calle2: "",
      ciudad: "",
      codigoPostal: "",
      pais: "Colombia",
      latitud: "",
      longitud: "",
      uploadSpeed: "10M",
      downloadSpeed: "10M",
    });
  };

  const createClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const username = formatUsernameForMikrotik(data.nombre, data.apellidos);
      
      // Crear comentario con toda la información del cliente
      const clientInfo = [
        `${data.nombre} ${data.apellidos}`,
        data.correoElectronico,
        data.telefono,
        `${data.calle}${data.calle2 ? ', ' + data.calle2 : ''}`,
        `${data.ciudad}, ${data.codigoPostal}`,
        data.numeroCajaNap ? `NAP: ${data.numeroCajaNap}-${data.numeroPuertoCajaNap}` : '',
        data.latitud && data.longitud ? `GPS: ${data.latitud}, ${data.longitud}` : ''
      ].filter(Boolean).join(' | ');

      if (useSimpleQueues) {
        // Crear Simple Queue
        const nextIP = await getNextAvailableIPFromQueues();
        const maxLimit = `${data.uploadSpeed}/${data.downloadSpeed}`;
        
        const { data: result, error } = await supabase.functions.invoke("mikrotik-v6-api", {
          body: {
            mikrotikId,
            command: "simple-queue-add",
            params: {
              name: username,
              target: `${nextIP}/32`,
              "max-limit": maxLimit,
              comment: clientInfo,
            },
          },
        });

        if (error) throw error;
        if (!result.success) throw new Error(result.error);
        
        return { 
          username, 
          remoteIP: nextIP, 
          clientName: `${data.nombre} ${data.apellidos}`,
          type: 'queue' as const,
          speed: maxLimit
        };
      } else {
        // Crear PPPoE
        if (!useStandardPassword || !standardPassword) {
          throw new Error("Configure una contraseña estándar antes de registrar clientes PPPoE");
        }
        
        const nextIP = await getNextAvailableIPFromPPPoE();
        const password = standardPassword;
        
        const { data: result, error } = await supabase.functions.invoke("mikrotik-v6-api", {
          body: {
            mikrotikId,
            command: "ppp-secret-add",
            params: {
              name: username,
              password: password,
              service: "pppoe",
              profile: data.plan || undefined,
              "remote-address": nextIP,
              comment: clientInfo,
            },
          },
        });

        if (error) throw error;
        if (!result.success) throw new Error(result.error);
        
        return { 
          username, 
          password, 
          remoteIP: nextIP, 
          clientName: `${data.nombre} ${data.apellidos}`,
          type: 'pppoe' as const
        };
      }
    },
    onSuccess: async (result) => {
      // Guardar en el historial de clientes
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          await supabase.from('isp_clients').insert({
            mikrotik_id: mikrotikId,
            created_by: userData.user.id,
            client_name: result.clientName,
            identification_number: formData.numeroIdentificacion,
            phone: formData.telefono,
            email: formData.correoElectronico,
            address: `${formData.calle}${formData.calle2 ? ', ' + formData.calle2 : ''}`,
            city: formData.ciudad,
            latitude: formData.latitud,
            longitude: formData.longitud,
            connection_type: result.type === 'pppoe' ? 'pppoe' : 'simple_queue',
            username: result.username,
            assigned_ip: result.remoteIP,
            plan_or_speed: result.type === 'pppoe' ? formData.plan : result.speed,
            is_potential_client: formData.clientePotencial,
            comment: formData.numeroCajaNap ? `NAP: ${formData.numeroCajaNap}-${formData.numeroPuertoCajaNap}` : null
          });
        }
      } catch (err) {
        console.error('Error saving client to history:', err);
      }

      const isPPPoE = result.type === 'pppoe';
      const message = isPPPoE 
        ? `🌐 *Datos de conexión PPPoE*\n\n👤 Cliente: ${result.clientName}\n📧 Usuario: ${result.username}\n🔑 Contraseña: ${result.password}\n🌍 IP Asignada: ${result.remoteIP}\n\n¡Gracias por confiar en nosotros!`
        : `🌐 *Datos de conexión*\n\n👤 Cliente: ${result.clientName}\n📧 Nombre: ${result.username}\n🌍 IP Asignada: ${result.remoteIP}\n⚡ Velocidad: ${result.speed}\n\n¡Gracias por confiar en nosotros!`;
      
      const copyToClipboard = () => {
        navigator.clipboard.writeText(message.replace(/\*/g, ''));
        toast.success("Copiado al portapapeles");
      };

      const shareWhatsApp = () => {
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
      };

      toast.success(
        <div className="space-y-3">
          <p className="font-semibold">✅ Cliente registrado exitosamente ({isPPPoE ? 'PPPoE' : 'Simple Queue'})</p>
          <div className="text-sm space-y-1 bg-muted p-2 rounded">
            <p><strong>Cliente:</strong> {result.clientName}</p>
            <p><strong>{isPPPoE ? 'Usuario' : 'Nombre'}:</strong> {result.username}</p>
            {isPPPoE && <p><strong>Contraseña:</strong> {result.password}</p>}
            <p><strong>IP:</strong> {result.remoteIP}</p>
            {!isPPPoE && <p><strong>Velocidad:</strong> {result.speed}</p>}
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={copyToClipboard}
              className="flex-1 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
            >
              📋 Copiar
            </button>
            <button
              onClick={shareWhatsApp}
              className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
            >
              📱 WhatsApp
            </button>
          </div>
        </div>,
        { duration: 30000 }
      );
      
      if (useSimpleQueues) {
        queryClient.invalidateQueries({ queryKey: ["isp-simple-queues"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["isp-pppoe-users"] });
      }
      queryClient.invalidateQueries({ queryKey: ["isp-clients"] });
      
      // Notificar datos del cliente registrado para el contrato
      const registeredData: RegisteredClientData = {
        clientName: result.clientName,
        identification: formData.numeroIdentificacion,
        address: `${formData.calle}${formData.calle2 ? ', ' + formData.calle2 : ''}, ${formData.ciudad}`,
        phone: formData.telefono,
        email: formData.correoElectronico,
        plan: result.type === 'pppoe' ? formData.plan : 'Simple Queue',
        speed: result.type === 'pppoe' ? '' : result.speed || '',
        price: formData.precio,
      };
      onClientRegistered?.(registeredData);
      
      resetFormData();
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al registrar cliente");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.nombre || !formData.apellidos || !formData.numeroIdentificacion) {
      toast.error("Por favor complete los campos obligatorios");
      return;
    }

    // Validar según el tipo de conexión
    if (!useSimpleQueues && !formData.plan) {
      toast.error("Seleccione un plan de servicio");
      return;
    }

    if (useSimpleQueues && (!formData.uploadSpeed || !formData.downloadSpeed)) {
      toast.error("Seleccione las velocidades de subida y bajada");
      return;
    }

    if (!formData.latitud || !formData.longitud) {
      toast.warning("Recuerde: Debe compartir su ubicación GPS para completar el registro");
    }

    createClientMutation.mutate(formData);
  };

  return (
    <Card className="border-2">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Sección General */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">General</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre *</Label>
                <Input
                  id="nombre"
                  placeholder="Juan"
                  value={formData.nombre}
                  onChange={(e) => updateField("nombre", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apellidos">Apellidos *</Label>
                <Input
                  id="apellidos"
                  placeholder="Pérez"
                  value={formData.apellidos}
                  onChange={(e) => updateField("apellidos", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="clientePotencial"
                checked={formData.clientePotencial}
                onCheckedChange={(checked) => updateField("clientePotencial", checked as boolean)}
              />
              <Label htmlFor="clientePotencial" className="text-sm cursor-pointer">
                Cliente potencial
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="numeroIdentificacion">Número de Identificación *</Label>
              <Input
                id="numeroIdentificacion"
                placeholder="1234567890"
                value={formData.numeroIdentificacion}
                onChange={(e) => updateField("numeroIdentificacion", e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="numeroCajaNap">Número Caja NAP</Label>
                <Input
                  id="numeroCajaNap"
                  placeholder="NAP-001"
                  value={formData.numeroCajaNap}
                  onChange={(e) => updateField("numeroCajaNap", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="numeroPuertoCajaNap">Número Puerto Caja NAP</Label>
                <Input
                  id="numeroPuertoCajaNap"
                  placeholder="8"
                  value={formData.numeroPuertoCajaNap}
                  onChange={(e) => updateField("numeroPuertoCajaNap", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Sección Tipo de Conexión */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">Tipo de Conexión</h3>
            
            {/* Selector de tipo de conexión */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Opción PPPoE */}
              <button
                type="button"
                onClick={() => setUseSimpleQueues(false)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  !useSimpleQueues 
                    ? 'border-cyan-500 bg-cyan-500/10 ring-2 ring-cyan-500/20' 
                    : 'border-muted hover:border-cyan-500/50 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${!useSimpleQueues ? 'bg-cyan-500/20' : 'bg-muted'}`}>
                    <Cable className={`h-5 w-5 ${!useSimpleQueues ? 'text-cyan-500' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${!useSimpleQueues ? 'text-cyan-600 dark:text-cyan-400' : 'text-foreground'}`}>
                        PPPoE
                      </p>
                      {!useSimpleQueues && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-cyan-500 text-white rounded-full">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Crear usuario PPPoE con perfil de velocidad
                    </p>
                  </div>
                </div>
              </button>

              {/* Opción Simple Queues */}
              <button
                type="button"
                onClick={() => setUseSimpleQueues(true)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  useSimpleQueues 
                    ? 'border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/20' 
                    : 'border-muted hover:border-orange-500/50 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${useSimpleQueues ? 'bg-orange-500/20' : 'bg-muted'}`}>
                    <Gauge className={`h-5 w-5 ${useSimpleQueues ? 'text-orange-500' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${useSimpleQueues ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
                        Simple Queues
                      </p>
                      {useSimpleQueues && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-orange-500 text-white rounded-full">
                          Seleccionado
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Crear cola de ancho de banda con IP estática
                    </p>
                  </div>
                </div>
              </button>
            </div>
            
            {/* Información del tipo seleccionado */}
            <div className={`text-sm p-3 rounded-lg ${useSimpleQueues ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
              {useSimpleQueues ? (
                <p className="text-orange-700 dark:text-orange-400">
                  <strong>Simple Queue:</strong> Se creará una cola con límite de velocidad. La IP se asignará automáticamente basándose en las colas existentes.
                </p>
              ) : (
                <p className="text-cyan-700 dark:text-cyan-400">
                  <strong>PPPoE:</strong> Se creará un usuario PPPoE. La IP se asignará automáticamente basándose en los usuarios existentes.
                </p>
              )}
            </div>
          </div>

          {/* Sección Plan de Servicio */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">
              {useSimpleQueues ? 'Configuración de Velocidad' : 'Plan de Servicio'}
            </h3>
            
            {useSimpleQueues ? (
              /* Campos de velocidad para Simple Queues */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="uploadSpeed">Velocidad de Subida *</Label>
                  <Select value={formData.uploadSpeed} onValueChange={(value) => updateField("uploadSpeed", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione velocidad" />
                    </SelectTrigger>
                    <SelectContent>
                      {['1M', '2M', '3M', '4M', '5M', '6M', '8M', '10M', '15M', '20M', '25M', '30M', '50M', '100M'].map((speed) => (
                        <SelectItem key={speed} value={speed}>
                          {speed.replace('M', ' Mbps')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="downloadSpeed">Velocidad de Bajada *</Label>
                  <Select value={formData.downloadSpeed} onValueChange={(value) => updateField("downloadSpeed", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione velocidad" />
                    </SelectTrigger>
                    <SelectContent>
                      {['1M', '2M', '3M', '4M', '5M', '6M', '8M', '10M', '15M', '20M', '25M', '30M', '50M', '100M'].map((speed) => (
                        <SelectItem key={speed} value={speed}>
                          {speed.replace('M', ' Mbps')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              /* Selector de perfil PPPoE */
              <div className="space-y-2">
                <Label htmlFor="plan">Seleccione su plan *</Label>
                <Select value={formData.plan} onValueChange={(value) => updateField("plan", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingProfiles ? (
                      <SelectItem value="loading" disabled>Cargando perfiles...</SelectItem>
                    ) : pppoeProfiles.length === 0 ? (
                      <SelectItem value="empty" disabled>No hay perfiles disponibles</SelectItem>
                    ) : (
                      pppoeProfiles.map((profile: any) => (
                        <SelectItem key={profile[".id"]} value={profile.name}>
                          {profile.name} {profile["rate-limit"] && `(${profile["rate-limit"]})`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Campo de precio del plan con gestor de precios */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="precio">Precio Mensual del Plan</Label>
                <PlanPricesManager
                  plans={pppoeProfiles.map((p: any) => ({ 
                    name: p.name, 
                    rateLimit: p["rate-limit"] 
                  }))}
                  speeds={availableSpeeds}
                  useSimpleQueues={useSimpleQueues}
                  onPricesChange={() => setPricesVersion(v => v + 1)}
                />
              </div>
              <Input
                id="precio"
                placeholder="Ej: $50.000 COP/mes"
                value={formData.precio}
                onChange={(e) => updateField("precio", e.target.value)}
              />
              {/* Mostrar si hay precio guardado */}
              {useSimpleQueues && formData.downloadSpeed && getSpeedPrices()[formData.downloadSpeed] && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <span>✓</span> Precio configurado: {getSpeedPrices()[formData.downloadSpeed]}
                </p>
              )}
              {!useSimpleQueues && formData.plan && getPlanPrices()[formData.plan] && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <span>✓</span> Precio configurado: {getPlanPrices()[formData.plan]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                El precio se carga automáticamente según el plan/velocidad configurado
              </p>
            </div>

            <div className="space-y-3">
              <Label>Opciones de Televisión *</Label>
              <RadioGroup
                value={formData.opcionTv}
                onValueChange={(value) => updateField("opcionTv", value)}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="solo-internet" id="solo-internet" />
                  <Label htmlFor="solo-internet" className="cursor-pointer font-normal">
                    <span className="font-medium text-primary">Solo Internet</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tv-incluido" id="tv-incluido" />
                  <Label htmlFor="tv-incluido" className="cursor-pointer font-normal">
                    <span className="font-medium">TV Incluido en el Plan</span>
                    <span className="text-muted-foreground text-sm block">Sin costo adicional</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tv-adicional" id="tv-adicional" />
                  <Label htmlFor="tv-adicional" className="cursor-pointer font-normal">
                    <span className="font-medium">+TV Adicional</span>
                    <span className="text-muted-foreground text-sm block">Agregar servicio de TV con costo adicional</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="solo-tv" id="solo-tv" />
                  <Label htmlFor="solo-tv" className="cursor-pointer font-normal">
                    <span className="font-medium">Solo TV</span>
                    <span className="text-muted-foreground text-sm block">Solo servicio de televisión sin internet</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Sección Información de Contacto */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">Información de Contacto</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="correoElectronico">Correo Electrónico *</Label>
                <Input
                  id="correoElectronico"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={formData.correoElectronico}
                  onChange={(e) => updateField("correoElectronico", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono *</Label>
                <Input
                  id="telefono"
                  type="tel"
                  placeholder="+57 300 123 4567"
                  value={formData.telefono}
                  onChange={(e) => updateField("telefono", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Sección Ubicación */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">Ubicación</h3>
            
            <div className="space-y-2">
              <Label htmlFor="calle">Calle *</Label>
              <Input
                id="calle"
                placeholder="Calle 123 #45-67"
                value={formData.calle}
                onChange={(e) => updateField("calle", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="calle2">Calle 2 (Opcional)</Label>
              <Input
                id="calle2"
                placeholder="Apartamento, Edificio, Torre, etc."
                value={formData.calle2}
                onChange={(e) => updateField("calle2", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ciudad">Ciudad *</Label>
                <Input
                  id="ciudad"
                  placeholder="Cali"
                  value={formData.ciudad}
                  onChange={(e) => updateField("ciudad", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="codigoPostal">Código Postal *</Label>
                <Input
                  id="codigoPostal"
                  placeholder="760001"
                  value={formData.codigoPostal}
                  onChange={(e) => updateField("codigoPostal", e.target.value)}
                />
              </div>
              <div className="space-y-2 col-span-2 md:col-span-1">
                <Label htmlFor="pais">País *</Label>
                <Input
                  id="pais"
                  placeholder="Colombia"
                  value={formData.pais}
                  onChange={(e) => updateField("pais", e.target.value)}
                />
              </div>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg space-y-4">
              <h4 className="font-medium flex items-center gap-2 text-sm uppercase text-muted-foreground">
                <MapPin className="w-4 h-4" />
                Ubicación de GPS
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="latitud">Latitud de GPS</Label>
                  <Input
                    id="latitud"
                    placeholder="Haga clic en 'Obtener ubicación'"
                    value={formData.latitud}
                    onChange={(e) => updateField("latitud", e.target.value)}
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitud">Longitud de GPS</Label>
                  <Input
                    id="longitud"
                    placeholder="Haga clic en 'Obtener ubicación'"
                    value={formData.longitud}
                    onChange={(e) => updateField("longitud", e.target.value)}
                    readOnly
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  <strong>Recuerde:</strong> Debe compartir su ubicación GPS para completar el registro. Esto nos permite planificar la instalación del servicio.
                </p>
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full"
                onClick={handleGetLocation}
                disabled={isGettingLocation}
              >
                <MapPin className="w-4 h-4 mr-2" />
                {isGettingLocation ? "Obteniendo ubicación..." : "Obtener Ubicación GPS"}
              </Button>
            </div>
          </div>

          {/* Botón de registro */}
          <Button 
            type="submit" 
            className={`w-full ${useSimpleQueues 
              ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600' 
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600'}`}
            size="lg"
            disabled={
              createClientMutation.isPending || 
              !formData.nombre || 
              !formData.apellidos || 
              !formData.numeroIdentificacion || 
              (useSimpleQueues ? (!formData.uploadSpeed || !formData.downloadSpeed) : !formData.plan)
            }
          >
            {useSimpleQueues ? <Gauge className="w-5 h-5 mr-2" /> : <Cable className="w-5 h-5 mr-2" />}
            {createClientMutation.isPending 
              ? "Registrando..." 
              : useSimpleQueues 
                ? "Registrar con Simple Queue" 
                : "Registrar con PPPoE"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}