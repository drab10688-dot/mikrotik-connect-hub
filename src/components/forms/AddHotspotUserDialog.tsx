import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addHotspotUser } from "@/lib/mikrotik";

interface AddHotspotUserDialogProps {
  onSuccess: () => void;
}

export const AddHotspotUserDialog = ({ onSuccess }: AddHotspotUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    password: "",
    profile: "default",
    limit: "",
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
      setFormData({ name: "", password: "", profile: "default", limit: "" });
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
                <SelectItem value="default">default</SelectItem>
                <SelectItem value="1hora">1 hora</SelectItem>
                <SelectItem value="3horas">3 horas</SelectItem>
                <SelectItem value="1dia">1 día</SelectItem>
                <SelectItem value="1semana">1 semana</SelectItem>
                <SelectItem value="1mes">1 mes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="limit">Límite de Tiempo (opcional)</Label>
            <Input
              id="limit"
              value={formData.limit}
              onChange={(e) => setFormData({ ...formData, limit: e.target.value })}
              placeholder="1d 2h 30m"
            />
            <p className="text-xs text-muted-foreground">
              Formato: 1d = 1 día, 2h = 2 horas, 30m = 30 minutos
            </p>
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
