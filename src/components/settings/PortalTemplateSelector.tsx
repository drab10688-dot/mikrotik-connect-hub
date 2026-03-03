import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Palette, Upload, X, Eye, Type, ImageIcon } from "lucide-react";
import {
  portalTemplates,
  getSelectedTemplateId,
  setSelectedTemplateId,
  getCustomLogo,
  setCustomLogo,
  getCustomTitle,
  setCustomTitle,
  PortalTemplate,
} from "@/lib/portal-templates";

export function PortalTemplateSelector() {
  const [activeId, setActiveId] = useState(getSelectedTemplateId());
  const [title, setTitle] = useState(getCustomTitle());
  const [logoPreview, setLogoPreview] = useState<string | null>(getCustomLogo());
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSelect = (id: string) => {
    setActiveId(id);
    setSelectedTemplateId(id);
    toast.success("Plantilla activada");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast.error("La imagen debe ser menor a 500KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoPreview(dataUrl);
      setCustomLogo(dataUrl);
      toast.success("Logo personalizado guardado");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoPreview(null);
    setCustomLogo(null);
    toast.success("Logo removido, se usará el predeterminado");
  };

  const handleSaveTitle = () => {
    setCustomTitle(title);
    toast.success("Título guardado");
  };

  const handlePreview = () => {
    const mikrotikId = localStorage.getItem("mikrotik_device_id") || "";
    window.open(`/portal?id=${mikrotikId}`, "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Palette className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Plantillas del Portal</CardTitle>
              <CardDescription>Elige un diseño para tu portal cautivo</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handlePreview} className="gap-2">
            <Eye className="h-4 w-4" />
            Vista previa
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Personalización */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Logo */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">Logo personalizado</Label>
            </div>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <div className="relative">
                  <img src={logoPreview} alt="Logo" className="h-14 w-14 rounded-full object-cover border" />
                  <button
                    onClick={handleRemoveLogo}
                    className="absolute -top-1 -right-1 rounded-full p-0.5 bg-destructive text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="h-14 w-14 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                  <Upload className="h-5 w-5 text-muted-foreground/50" />
                </div>
              )}
              <div className="flex-1">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="w-full">
                  <Upload className="h-4 w-4 mr-2" />
                  {logoPreview ? "Cambiar logo" : "Subir logo"}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1">PNG/JPG, máx 500KB</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>

          {/* Título */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">Título del portal</Label>
            </div>
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Portal de Acceso"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleSaveTitle}>
                Guardar
              </Button>
            </div>
          </div>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {portalTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isActive={activeId === template.id}
              onSelect={() => handleSelect(template.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateCard({
  template,
  isActive,
  onSelect,
}: {
  template: PortalTemplate;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative rounded-xl border-2 overflow-hidden transition-all text-left group ${
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-primary/40"
      }`}
    >
      {/* Mini Preview */}
      <div className="aspect-[4/3] p-3 flex items-center justify-center" style={{ background: template.preview.bg }}>
        <div
          className="w-full max-w-[80%] rounded-lg p-3 space-y-2"
          style={{
            background: template.preview.card,
            boxShadow: `0 4px 20px ${template.preview.accent}22`,
          }}
        >
          <div className="w-6 h-6 rounded-full mx-auto" style={{ background: template.preview.accent, opacity: 0.7 }} />
          <div className="h-1.5 rounded-full w-3/4 mx-auto" style={{ background: template.preview.accent, opacity: 0.3 }} />
          <div className="space-y-1.5">
            <div className="h-4 rounded" style={{ background: `${template.preview.bg}`, border: `1px solid ${template.preview.accent}33` }} />
            <div className="h-4 rounded" style={{ background: `${template.preview.bg}`, border: `1px solid ${template.preview.accent}33` }} />
          </div>
          <div className="h-5 rounded" style={{ background: template.preview.accent, opacity: 0.8 }} />
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5 border-t bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-foreground">{template.name}</p>
            <p className="text-[10px] text-muted-foreground line-clamp-1">{template.description}</p>
          </div>
          {isActive && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px] gap-0.5">
              <Check className="h-3 w-3" />
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
