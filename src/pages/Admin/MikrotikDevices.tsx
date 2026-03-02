import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { devicesApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Plus, Trash2, Server, CheckCircle, XCircle, Clock, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function MikrotikDevices() {
  const queryClient = useQueryClient();
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', host: '', username: '', password: '', port: 8728, version: 'v6', hotspot_url: 'http://192.168.88.1/login' });

  const { data: devices, isLoading } = useQuery({
    queryKey: ['mikrotik-devices', user?.id],
    queryFn: () => devicesApi.list(),
    enabled: !!user,
  });

  const { data: pendingDevices, isLoading: loadingPending } = useQuery({
    queryKey: ['mikrotik-devices-pending', user?.id],
    queryFn: () => devicesApi.list(),
    enabled: !!user && isSuperAdmin,
    select: (data: any[]) => data?.filter(d => d.status === 'pending') || [],
  });

  const createDeviceMutation = useMutation({
    mutationFn: (data: typeof formData) => devicesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      toast.success(isSuperAdmin ? 'MikroTik agregado exitosamente' : 'MikroTik enviado para aprobación');
      setOpen(false);
      setFormData({ name: '', host: '', username: '', password: '', port: 8728, version: 'v6', hotspot_url: 'http://192.168.88.1/login' });
    },
    onError: (error: any) => toast.error(error.message || 'Error al agregar MikroTik'),
  });

  const updateDeviceStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => devicesApi.update(id, { status }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      toast.success(variables.status === 'active' ? 'Dispositivo activado exitosamente' : 'Dispositivo rechazado');
    },
    onError: (error: any) => toast.error(error.message || 'Error al actualizar dispositivo'),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (id: string) => devicesApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] }); toast.success('MikroTik eliminado exitosamente'); },
    onError: (error: any) => toast.error(error.message || 'Error al eliminar MikroTik'),
  });

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); createDeviceMutation.mutate(formData); };
  const handleDelete = (id: string, name: string) => { if (window.confirm(`¿Eliminar "${name}"?`)) deleteDeviceMutation.mutate(id); };
  const handleApprove = (id: string) => updateDeviceStatusMutation.mutate({ id, status: 'active' });
  const handleReject = (id: string) => { if (window.confirm('¿Rechazar este dispositivo?')) updateDeviceStatusMutation.mutate({ id, status: 'rejected' }); };

  const getStatusBadge = (status: string) => {
    const config = { active: { label: 'Activo', variant: 'default' as const }, pending: { label: 'Pendiente', variant: 'secondary' as const }, rejected: { label: 'Rechazado', variant: 'destructive' as const } };
    const { label, variant } = config[status as keyof typeof config] || config.pending;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const activeDevices = devices?.filter((d: any) => d.status === 'active') || [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{isSuperAdmin ? 'Dispositivos MikroTik' : 'Mis Dispositivos MikroTik'}</h1>
              <p className="text-muted-foreground">{isSuperAdmin ? 'Gestiona todas las conexiones a routers MikroTik' : 'Gestiona tus conexiones a routers MikroTik'}</p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Agregar MikroTik</Button></DialogTrigger>
              <DialogContent>
                <form onSubmit={handleSubmit}>
                  <DialogHeader><DialogTitle>Agregar Nuevo MikroTik</DialogTitle><DialogDescription>Configura la conexión a un router MikroTik</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2"><Label>Nombre</Label><Input placeholder="MikroTik Principal" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Host/IP</Label><Input placeholder="192.168.1.1" value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })} required /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Usuario</Label><Input placeholder="admin" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required /></div>
                      <div className="space-y-2"><Label>Contraseña</Label><Input type="password" placeholder="••••••••" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Puerto</Label><Input type="number" value={formData.port} onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })} required /></div>
                      <div className="space-y-2"><Label>Versión</Label><Select value={formData.version} onValueChange={(v) => setFormData({ ...formData, version: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="v6">v6 (API)</SelectItem><SelectItem value="v7">v7 (REST)</SelectItem></SelectContent></Select></div>
                    </div>
                    <div className="space-y-2"><Label>URL del Portal Hotspot</Label><Input placeholder="http://192.168.88.1/login" value={formData.hotspot_url} onChange={(e) => setFormData({ ...formData, hotspot_url: e.target.value })} /></div>
                  </div>
                  <DialogFooter><Button type="submit" disabled={createDeviceMutation.isPending}>{createDeviceMutation.isPending ? 'Guardando...' : 'Guardar'}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {isSuperAdmin && pendingDevices && pendingDevices.length > 0 && (
            <Card className="border-orange-500/50">
              <CardHeader><div className="flex items-center gap-2"><Clock className="h-5 w-5 text-orange-500" /><CardTitle>Dispositivos Pendientes de Aprobación</CardTitle></div></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Nombre</TableHead><TableHead>Host</TableHead><TableHead>Puerto</TableHead><TableHead>Versión</TableHead><TableHead>Fecha</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
                  <TableBody>{pendingDevices.map((device: any) => (
                    <TableRow key={device.id}>
                      <TableCell><div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /><div><p className="font-medium text-sm">{device.profile?.full_name || 'Sin nombre'}</p><p className="text-xs text-muted-foreground">{device.profile?.email}</p></div></div></TableCell>
                      <TableCell className="font-medium">{device.name}</TableCell><TableCell>{device.host}</TableCell><TableCell>{device.port}</TableCell><TableCell>{device.version}</TableCell>
                      <TableCell>{new Date(device.created_at).toLocaleDateString('es-ES')}</TableCell>
                      <TableCell><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => handleApprove(device.id)}><CheckCircle className="h-4 w-4 text-green-500" /></Button><Button variant="ghost" size="sm" onClick={() => handleReject(device.id)}><XCircle className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>MikroTiks Configurados</CardTitle><CardDescription>Lista de dispositivos MikroTik activos en el sistema</CardDescription></CardHeader>
            <CardContent>
              {isLoading ? <div className="text-center py-8">Cargando dispositivos...</div>
              : activeDevices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground"><Server className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No hay dispositivos MikroTik activos</p></div>
              ) : (
                <Table><TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Host</TableHead><TableHead>Puerto</TableHead><TableHead>Versión</TableHead><TableHead>Fecha</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
                  <TableBody>{activeDevices.map((device: any) => (
                    <TableRow key={device.id}>
                      <TableCell className="font-medium">{device.name}</TableCell><TableCell>{device.host}</TableCell><TableCell>{device.port}</TableCell><TableCell>{device.version}</TableCell>
                      <TableCell>{new Date(device.created_at).toLocaleDateString('es-ES')}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => handleDelete(device.id, device.name)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
