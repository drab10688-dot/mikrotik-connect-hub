import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addPPPoEUser } from "@/lib/mikrotik";

interface AddPPPoEUserDialogProps {
  onSuccess: () => void;
}

export const AddPPPoEUserDialog = ({ onSuccess }: AddPPPoEUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    service: "pppoe",
    profile: "default",
    localAddress: "",
    remoteAddress: "",
    comment: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await addPPPoEUser(formData);
      toast.success("Usuario PPPoE creado exitosamente");
      setOpen(false);
      setFormData({
        name: "",
        password: "",
        service: "pppoe",
        profile: "default",
        localAddress: "",
        remoteAddress: "",
        comment: "",
      });
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || "Error al crear usuario");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Agregar Usuario PPPoE
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear Usuario PPPoE</DialogTitle>
          <DialogDescription>
            Agrega un nuevo usuario PPPoE con sus credenciales y configuración
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre de Usuario *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="cliente01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña *</Label>
              <Input
                id="password"
                type="text"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Pass123"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="service">Servicio</Label>
              <Select value={formData.service} onValueChange={(value) => setFormData({ ...formData, service: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="pppoe">PPPoE</SelectItem>
                  <SelectItem value="pptp">PPTP</SelectItem>
                  <SelectItem value="l2tp">L2TP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile">Perfil</Label>
              <Input
                id="profile"
                value={formData.profile}
                onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
                placeholder="default"
              />
            </div>
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
              <Label htmlFor="remoteAddress">Dirección IP Remota</Label>
              <Input
                id="remoteAddress"
                value={formData.remoteAddress}
                onChange={(e) => setFormData({ ...formData, remoteAddress: e.target.value })}
                placeholder="10.0.0.100"
              />
              <p className="text-xs text-muted-foreground">IP asignada al cliente</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment">Comentario</Label>
            <Input
              id="comment"
              value={formData.comment}
              onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
              placeholder="Cliente residencial - Plan 10MB"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creando..." : "Crear Usuario"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
