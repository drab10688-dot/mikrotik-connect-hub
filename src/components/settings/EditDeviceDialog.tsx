import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

interface EditDeviceDialogProps {
  device: {
    id: string;
    name: string;
    host: string;
    username: string;
    password: string;
    port: number;
    version: string;
    hotspot_url: string | null;
  };
}

export const EditDeviceDialog = ({ device }: EditDeviceDialogProps) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: device.name,
    host: device.host,
    username: device.username,
    password: device.password,
    port: device.port,
    version: device.version,
    hotspot_url: device.hotspot_url || 'http://192.168.88.1/login',
  });

  useEffect(() => {
    if (open) {
      setFormData({
        name: device.name,
        host: device.host,
        username: device.username,
        password: device.password,
        port: device.port,
        version: device.version,
        hotspot_url: device.hotspot_url || 'http://192.168.88.1/login',
      });
    }
  }, [open, device]);

  const updateDeviceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from('mikrotik_devices')
        .update(data)
        .eq('id', device.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      
      toast.success('Dispositivo actualizado exitosamente');
      setOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar dispositivo');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateDeviceMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Editar Dispositivo MikroTik</DialogTitle>
            <DialogDescription>
              Modifica la configuración del dispositivo
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                placeholder="MikroTik Principal"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="host">Host/IP</Label>
              <Input
                id="host"
                placeholder="192.168.1.1"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  placeholder="admin"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="port">Puerto</Label>
                <Input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="version">Versión</Label>
                <Select
                  value={formData.version}
                  onValueChange={(value) => setFormData({ ...formData, version: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v6">v6 (API)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hotspot_url">URL del Portal Hotspot</Label>
              <Input
                id="hotspot_url"
                placeholder="http://192.168.88.1/login"
                value={formData.hotspot_url}
                onChange={(e) => setFormData({ ...formData, hotspot_url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Esta URL se usará en el código QR de los vouchers para acceso directo
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateDeviceMutation.isPending}>
              {updateDeviceMutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};