import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addPPPoEProfile } from "@/lib/mikrotik";

interface AddPPPoEProfileDialogProps {
  onSuccess: () => void;
}

export const AddPPPoEProfileDialog = ({ onSuccess }: AddPPPoEProfileDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    rateLimit: "",
    localAddress: "",
    remoteAddress: "",
    sessionTimeout: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await addPPPoEProfile({
        name: formData.name,
        "rate-limit": formData.rateLimit,
        "local-address": formData.localAddress,
        "remote-address": formData.remoteAddress,
        "session-timeout": formData.sessionTimeout,
      });
      toast.success("Perfil PPPoE creado exitosamente");
      setOpen(false);
      setFormData({
        name: "",
        rateLimit: "",
        localAddress: "",
        remoteAddress: "",
        sessionTimeout: "",
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
          <DialogTitle>Crear Perfil PPPoE</DialogTitle>
          <DialogDescription>
            Configura límites de velocidad y direcciones IP para conexiones PPPoE
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del Perfil *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="pppoe-10mb"
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
              <Label htmlFor="localAddress">Dirección IP Local</Label>
              <Input
                id="localAddress"
                value={formData.localAddress}
                onChange={(e) => setFormData({ ...formData, localAddress: e.target.value })}
                placeholder="10.0.0.1"
              />
              <p className="text-xs text-muted-foreground">IP del servidor PPPoE</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="remoteAddress">Pool de Direcciones IP</Label>
              <Input
                id="remoteAddress"
                value={formData.remoteAddress}
                onChange={(e) => setFormData({ ...formData, remoteAddress: e.target.value })}
                placeholder="pool-clientes"
              />
              <p className="text-xs text-muted-foreground">Pool de IPs para clientes</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sessionTimeout">Tiempo de Sesión</Label>
            <Input
              id="sessionTimeout"
              value={formData.sessionTimeout}
              onChange={(e) => setFormData({ ...formData, sessionTimeout: e.target.value })}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              En segundos (0 = sin límite)
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
