import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addPPPoEUser } from "@/lib/mikrotik";
import { usePPPoEProfiles } from "@/hooks/useMikrotikData";

interface AddPPPoEUserDialogProps {
  onSuccess: () => void;
}

export const AddPPPoEUserDialog = ({ onSuccess }: AddPPPoEUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { data: pppoeProfilesData } = usePPPoEProfiles();
  const pppoeProfiles = (pppoeProfilesData as any[]) || [];
  
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    service: "pppoe",
    profile: "default",
    "local-address": "",
    "remote-address": "",
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
        "local-address": "",
        "remote-address": "",
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
              <Select value={formData.profile} onValueChange={(value) => setFormData({ ...formData, profile: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pppoeProfiles.length > 0 ? (
                    pppoeProfiles.map((profile: any) => (
                      <SelectItem key={profile[".id"]} value={profile.name}>
                        {profile.name}
                        {profile["rate-limit"] && ` - ${profile["rate-limit"]}`}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="default">default</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="local-address">Dirección Local</Label>
              <Input
                id="local-address"
                value={formData["local-address"]}
                onChange={(e) => setFormData({ ...formData, "local-address": e.target.value })}
                placeholder="192.168.1.1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="remote-address">Dirección Remota</Label>
              <Input
                id="remote-address"
                value={formData["remote-address"]}
                onChange={(e) => setFormData({ ...formData, "remote-address": e.target.value })}
                placeholder="192.168.1.2"
              />
            </div>
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
