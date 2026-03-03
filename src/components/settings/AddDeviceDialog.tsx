import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { devicesApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Plus, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export const AddDeviceDialog = () => {
  const queryClient = useQueryClient();
  const { user, isSuperAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    username: '',
    password: '',
    port: 443,
    version: 'v7',
    hotspot_url: 'http://192.168.88.1/login',
  });

  const createDeviceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      await devicesApi.create({
        ...data,
        created_by: user?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending-count'] });
      
      if (isSuperAdmin) {
        toast.success('MikroTik agregado exitosamente');
      } else {
        toast.success('Dispositivo enviado para aprobación', {
          description: 'El administrador revisará y activará tu dispositivo pronto'
        });
      }
      
      setOpen(false);
      setFormData({
        name: '',
        host: '',
        username: '',
        password: '',
        port: 443,
        version: 'v7',
        hotspot_url: 'http://192.168.88.1/login',
      });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al agregar MikroTik');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createDeviceMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Agregar Dispositivo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Agregar Nuevo MikroTik</DialogTitle>
            <DialogDescription>
              Configura la conexión a un router MikroTik
            </DialogDescription>
          </DialogHeader>
          
          {!isSuperAdmin && (
            <Alert className="my-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Tu dispositivo será revisado y activado por el administrador antes de poder usarlo
              </AlertDescription>
            </Alert>
          )}
          
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
                <Label htmlFor="port">Puerto API</Label>
                <Input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 443 })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Común: 443 (HTTPS), 80 (HTTP), 8728 (API), 8730+
                </p>
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
                    <SelectItem value="v7">v7 (REST API)</SelectItem>
                    <SelectItem value="v6">v6 (API Legacy)</SelectItem>
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
            <Button type="submit" disabled={createDeviceMutation.isPending}>
              {createDeviceMutation.isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
