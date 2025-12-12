import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MapPin, UserPlus, AlertCircle } from "lucide-react";
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
}

interface ClientRegistrationFormProps {
  onSuccess?: () => void;
  useStandardPassword: boolean;
  standardPassword: string;
}

export function ClientRegistrationForm({ onSuccess, useStandardPassword, standardPassword }: ClientRegistrationFormProps) {
  const queryClient = useQueryClient();
  const mikrotikId = getSelectedDeviceId();
  const { data: pppoeProfilesData, isLoading: loadingProfiles } = usePPPoEProfiles();
  const pppoeProfiles = (pppoeProfilesData as any[]) || [];

  const [formData, setFormData] = useState<ClientFormData>({
    nombre: "",
    apellidos: "",
    clientePotencial: false,
    numeroIdentificacion: "",
    numeroCajaNap: "",
    numeroPuertoCajaNap: "",
    plan: "",
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
  });

  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const updateField = (field: keyof ClientFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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

  // Función para sanitizar texto (reemplazar ñ por n y otros caracteres problemáticos)
  const sanitizeForMikrotik = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/ñ/g, 'n')
      .replace(/Ñ/g, 'N')
      .replace(/á/g, 'a')
      .replace(/é/g, 'e')
      .replace(/í/g, 'i')
      .replace(/ó/g, 'o')
      .replace(/ú/g, 'u')
      .replace(/ü/g, 'u')
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '');
  };

  const createClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      if (!useStandardPassword || !standardPassword) {
        throw new Error("Configure una contraseña estándar antes de registrar clientes");
      }
      
      // Generar nombre de usuario sanitizado (nombre + identificación)
      const sanitizedName = sanitizeForMikrotik(data.nombre);
      const username = `${sanitizedName}_${data.numeroIdentificacion}`;
      const password = standardPassword;
      
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

      // Crear usuario PPPoE en MikroTik
      const { data: result, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "ppp-secret-add",
          params: {
            name: username,
            password: password,
            service: "pppoe",
            profile: data.plan || undefined,
            comment: clientInfo,
          },
        },
      });

      if (error) throw error;
      if (!result.success) throw new Error(result.error);
      
      return { username, password };
    },
    onSuccess: (result) => {
      toast.success(
        <div>
          <p className="font-semibold">Cliente registrado exitosamente</p>
          <p className="text-sm">Usuario: {result.username}</p>
          <p className="text-sm">Contraseña: {result.password}</p>
        </div>,
        { duration: 10000 }
      );
      queryClient.invalidateQueries({ queryKey: ["isp-pppoe-users"] });
      setFormData({
        nombre: "",
        apellidos: "",
        clientePotencial: false,
        numeroIdentificacion: "",
        numeroCajaNap: "",
        numeroPuertoCajaNap: "",
        plan: "",
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
      });
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

    if (!formData.plan) {
      toast.error("Seleccione un plan de servicio");
      return;
    }

    if (!formData.latitud || !formData.longitud) {
      toast.warning("Recuerde: Debe compartir su ubicación GPS para completar el registro");
    }

    createClientMutation.mutate(formData);
  };

  return (
    <Card className="border-2">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl md:text-2xl text-primary">Registro de Nuevo Cliente</CardTitle>
        <CardDescription>Complete el formulario para iniciar su registro</CardDescription>
      </CardHeader>
      <CardContent>
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

          {/* Sección Plan de Servicio */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">Plan de Servicio</h3>
            
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
            className="w-full" 
            size="lg"
            disabled={createClientMutation.isPending || !formData.nombre || !formData.apellidos || !formData.numeroIdentificacion || !formData.plan}
          >
            <UserPlus className="w-5 h-5 mr-2" />
            {createClientMutation.isPending ? "Registrando..." : "Registrar Cliente"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}