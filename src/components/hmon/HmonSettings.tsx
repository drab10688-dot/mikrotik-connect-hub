import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Upload, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

export function HmonSettings({ section }: { section: string }) {
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("hmon_business_name") || "WiFi Service");
  const [logo, setLogo] = useState(() => localStorage.getItem("hmon_logo") || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    localStorage.setItem("hmon_business_name", businessName);
    toast.success("Configuración guardada");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) { toast.error("Logo debe ser menor a 500KB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      setLogo(b64);
      localStorage.setItem("hmon_logo", b64);
      toast.success("Logo actualizado");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogo("");
    localStorage.removeItem("hmon_logo");
    toast.info("Logo eliminado");
  };

  if (section === "upload-logo") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Cargar Logo</h2></div>
        <Card>
          <CardContent className="py-6 space-y-4">
            {logo ? (
              <div className="flex flex-col items-center gap-3">
                <img src={logo} alt="Logo" className="max-w-[200px] max-h-[100px] object-contain rounded border" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1" />Cambiar</Button>
                  <Button variant="destructive" size="sm" onClick={handleRemoveLogo}><Trash2 className="h-3.5 w-3.5 mr-1" />Eliminar</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-32 h-32 border-2 border-dashed rounded-lg flex items-center justify-center">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Sube tu logo para los vouchers y tickets</p>
                <Button size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1" />Seleccionar Imagen</Button>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // General settings
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Settings className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">
        {section === "session-config" ? "Configuración de Sesión" : section === "admin-config" ? "Configuración de Administrador" : "Ajustes"}
      </h2></div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Configuración General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Nombre del Negocio</Label>
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="h-8 text-xs" placeholder="Mi WiFi Service" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Logo</Label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" />{logo ? "Cambiar Logo" : "Subir Logo"}
              </Button>
              {logo && <img src={logo} alt="Logo" className="h-8 object-contain rounded" />}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
          <Button size="sm" onClick={handleSave}><Save className="h-3.5 w-3.5 mr-1" />Guardar</Button>
        </CardContent>
      </Card>

      {section === "session-config" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Configuración de Sesión Hotspot</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">La configuración de sesión se gestiona directamente en los perfiles del hotspot MikroTik. Ve a la sección de Perfiles para modificar timeouts y límites de sesión.</p>
          </CardContent>
        </Card>
      )}

      {section === "admin-config" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Configuración de Administrador</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">La configuración de administrador se gestiona desde el panel principal de OmniSync en la sección de Configuración.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
