import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Plus, Trash2, Server } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function MikrotikDevices() {
  const queryClient = useQueryClient();
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    username: '',
    password: '',
    port: 8728,
    version: 'v6',
    hotspot_url: 'http://192.168.88.1/login',
  });

  const { data: devices, isLoading } = useQuery({
    queryKey: ['mikrotik-devices', user?.id],
    queryFn: async () => {
      let query = supabase
        .from('mikrotik_devices')
        .select('*');
      
      // Super admins see all devices, regular users see only their own
      if (isSuperAdmin) {
        // Super admins see all
      } else if (isAdmin) {
        // Admins see assigned devices
        const { data: accessData, error: accessError } = await supabase
          .from('user_mikrotik_access')
          .select('mikrotik_id')
          .eq('user_id', user?.id);
        
        if (accessError) throw accessError;
        const mikrotikIds = accessData.map(a => a.mikrotik_id);
        
        if (mikrotikIds.length === 0) return [];
        
        query = query.in('id', mikrotikIds);
      } else {
        // Regular users see their own devices
        query = query.eq('created_by', user?.id);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createDeviceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from('mikrotik_devices')
        .insert({
          ...data,
          created_by: user?.id,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      toast.success('MikroTik agregado exitosamente');
      setOpen(false);
      setFormData({
        name: '',
        host: '',
        username: '',
        password: '',
        port: 8728,
        version: 'v6',
        hotspot_url: 'http://192.168.88.1/login',
      });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al agregar MikroTik');
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('mikrotik_devices')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      toast.success('MikroTik eliminado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar MikroTik');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createDeviceMutation.mutate(formData);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`¿Estás seguro de eliminar el MikroTik "${name}"?`)) {
      deleteDeviceMutation.mutate(id);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-8 ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">
                {isSuperAdmin ? 'Dispositivos MikroTik' : 'Mis Dispositivos MikroTik'}
              </h1>
              <p className="text-muted-foreground">
                {isSuperAdmin 
                  ? 'Gestiona todas las conexiones a routers MikroTik'
                  : 'Gestiona tus conexiones a routers MikroTik'
                }
              </p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar MikroTik
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
                            <SelectItem value="v7">v7 (REST)</SelectItem>
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
          </div>

          <Card>
            <CardHeader>
              <CardTitle>MikroTiks Configurados</CardTitle>
              <CardDescription>
                Lista de dispositivos MikroTik registrados en el sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Cargando dispositivos...</div>
              ) : !devices || devices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay dispositivos MikroTik configurados</p>
                  <p className="text-sm">Agrega uno para comenzar</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>Puerto</TableHead>
                      <TableHead>Versión</TableHead>
                      <TableHead>URL Hotspot</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device: any) => (
                      <TableRow key={device.id}>
                        <TableCell className="font-medium">{device.name}</TableCell>
                        <TableCell>{device.host}</TableCell>
                        <TableCell>{device.port}</TableCell>
                        <TableCell>{device.version}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs">
                          {device.hotspot_url || 'No configurada'}
                        </TableCell>
                        <TableCell>
                          {new Date(device.created_at).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(device.id, device.name)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
