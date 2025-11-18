import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addHotspotUser } from "@/lib/mikrotik";
import { useHotspotProfiles } from "@/hooks/useMikrotikData";

interface AddHotspotUserDialogProps {
  onSuccess: () => void;
}

export const AddHotspotUserDialog = ({ onSuccess }: AddHotspotUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { data: hotspotProfilesData } = useHotspotProfiles();
  const hotspotProfiles = hotspotProfilesData?.data || [];
  
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    profile: "default",
  });

  const generateRandomCredentials = () => {
    const username = Math.random().toString(36).substring(2, 10).toUpperCase();
    const password = Math.random().toString(36).substring(2, 10).toUpperCase();
    setFormData({ ...formData, name: username, password: password });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await addHotspotUser(formData);
      toast.success("Usuario hotspot creado exitosamente");
      setOpen(false);
      setFormData({ name: "", password: "", profile: "default" });
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
          Agregar Usuario
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Usuario Hotspot</DialogTitle>
          <DialogDescription>
            Agrega un nuevo usuario para el hotspot de MikroTik
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre de Usuario</Label>
            <div className="flex gap-2">
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="usuario123"
                required
              />
              <Button
                type="button"
                variant="outline"
                onClick={generateRandomCredentials}
              >
                Generar
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="text"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Pass123"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile">Perfil</Label>
            <Select value={formData.profile} onValueChange={(value) => setFormData({ ...formData, profile: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hotspotProfiles.length > 0 ? (
                  hotspotProfiles.map((profile: any) => (
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
