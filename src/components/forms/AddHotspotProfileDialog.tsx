import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addHotspotProfile } from "@/lib/mikrotik";

interface AddHotspotProfileDialogProps {
  onSuccess: () => void;
}

export const AddHotspotProfileDialog = ({ onSuccess }: AddHotspotProfileDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    rateLimit: "",
    sessionTimeout: "",
    idleTimeout: "",
    sharedUsers: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await addHotspotProfile({
        name: formData.name,
        "rate-limit": formData.rateLimit,
        "session-timeout": formData.sessionTimeout,
        "idle-timeout": formData.idleTimeout,
        "shared-users": formData.sharedUsers,
      });
      toast.success("Perfil Hotspot creado exitosamente");
      setOpen(false);
      setFormData({
        name: "",
        rateLimit: "",
        sessionTimeout: "",
        idleTimeout: "",
        sharedUsers: "",
      });
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || "Error al crear perfil");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Agregar Perfil
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear Perfil Hotspot</DialogTitle>
          <DialogDescription>
            Configura límites de velocidad, tiempo de sesión y otras opciones
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del Perfil *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="plan-10mb"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rateLimit">Límite de Velocidad (Rate Limit)</Label>
            <Input
              id="rateLimit"
              value={formData.rateLimit}
              onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
              placeholder="10M/10M"
            />
            <p className="text-xs text-muted-foreground">
              Formato: subida/bajada (ej: 10M/10M, 512k/2M)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sessionTimeout">Tiempo de Sesión</Label>
              <Input
                id="sessionTimeout"
                value={formData.sessionTimeout}
                onChange={(e) => setFormData({ ...formData, sessionTimeout: e.target.value })}
                placeholder="1h"
              />
              <p className="text-xs text-muted-foreground">
                Ej: 1h, 30m, 1d (horas, minutos, días)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="idleTimeout">Tiempo de Inactividad</Label>
              <Input
                id="idleTimeout"
                value={formData.idleTimeout}
                onChange={(e) => setFormData({ ...formData, idleTimeout: e.target.value })}
                placeholder="5m"
              />
              <p className="text-xs text-muted-foreground">
                Desconectar después de inactividad
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sharedUsers">Usuarios Compartidos</Label>
            <Input
              id="sharedUsers"
              value={formData.sharedUsers}
              onChange={(e) => setFormData({ ...formData, sharedUsers: e.target.value })}
              placeholder="1"
            />
            <p className="text-xs text-muted-foreground">
              Número de usuarios que pueden usar simultáneamente
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creando..." : "Crear Perfil"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
