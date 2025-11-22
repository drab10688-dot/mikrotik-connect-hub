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
import { Plus, Trash2, Server, CheckCircle, XCircle, Clock, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
      
      const { data: devicesData, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      
      // Fetch user profiles for each device
      if (devicesData && devicesData.length > 0) {
        const userIds = [...new Set(devicesData.map(d => d.created_by))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);
        
        const profilesMap = new Map(profilesData?.map(p => [p.user_id, p]) || []);
        
        return devicesData.map(device => ({
          ...device,
          profile: profilesMap.get(device.created_by)
        }));
      }
      
      return devicesData;
    },
    enabled: !!user,
  });

  const { data: pendingDevices, isLoading: loadingPending } = useQuery({
    queryKey: ['mikrotik-devices-pending', user?.id],
    queryFn: async () => {
      if (!isSuperAdmin) return [];
      
      const { data: devicesData, error } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Fetch user profiles for each device
      if (devicesData && devicesData.length > 0) {
        const userIds = [...new Set(devicesData.map(d => d.created_by))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);
        
        const profilesMap = new Map(profilesData?.map(p => [p.user_id, p]) || []);
        
        return devicesData.map(device => ({
          ...device,
          profile: profilesMap.get(device.created_by)
        }));
      }
      
      return devicesData;
    },
    enabled: !!user && isSuperAdmin,
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
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
      if (isSuperAdmin) {
        toast.success('MikroTik agregado exitosamente');
      } else {
        toast.success('MikroTik enviado para aprobación', {
          description: 'El administrador revisará y activará tu dispositivo pronto'
        });
      }
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

  const updateDeviceStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'rejected' }) => {
      const { error } = await supabase
        .from('mikrotik_devices')
        .update({ status })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
      toast.success(
        variables.status === 'active' 
          ? 'Dispositivo activado exitosamente' 
          : 'Dispositivo rechazado'
      );
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar dispositivo');
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
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
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

  const handleApprove = (id: string) => {
    updateDeviceStatusMutation.mutate({ id, status: 'active' });
  };

  const handleReject = (id: string) => {
    if (window.confirm('¿Estás seguro de rechazar este dispositivo?')) {
      updateDeviceStatusMutation.mutate({ id, status: 'rejected' });
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      active: { label: 'Activo', variant: 'default' as const },
      pending: { label: 'Pendiente', variant: 'secondary' as const },
      rejected: { label: 'Rechazado', variant: 'destructive' as const },
    };
    
    const { label, variant } = config[status as keyof typeof config] || config.pending;
    
    return <Badge variant={variant}>{label}</Badge>;
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
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

{isSuperAdmin && pendingDevices && pendingDevices.length > 0 && (
            <Card className="border-orange-500/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  <CardTitle>Dispositivos Pendientes de Aprobación</CardTitle>
                </div>
                <CardDescription>
                  Revisa y aprueba los dispositivos creados por usuarios
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingPending ? (
                  <div className="text-center py-8">Cargando dispositivos pendientes...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Puerto</TableHead>
                        <TableHead>Versión</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingDevices.map((device: any) => (
                        <TableRow key={device.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="font-medium text-sm">
                                  {device.profile?.full_name || 'Sin nombre'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {device.profile?.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{device.name}</TableCell>
                          <TableCell>{device.host}</TableCell>
                          <TableCell>{device.port}</TableCell>
                          <TableCell>{device.version}</TableCell>
                          <TableCell>
                            {new Date(device.created_at).toLocaleDateString('es-ES')}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleApprove(device.id)}
                                disabled={updateDeviceStatusMutation.isPending}
                              >
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleReject(device.id)}
                                disabled={updateDeviceStatusMutation.isPending}
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="active" className="w-full">
            <TabsList>
              <TabsTrigger value="active">Dispositivos Activos</TabsTrigger>
              {isSuperAdmin && <TabsTrigger value="all">Todos los Estados</TabsTrigger>}
            </TabsList>
            
            <TabsContent value="active">
              <Card>
                <CardHeader>
                  <CardTitle>MikroTiks Configurados</CardTitle>
                  <CardDescription>
                    Lista de dispositivos MikroTik activos en el sistema
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="text-center py-8">Cargando dispositivos...</div>
                  ) : !devices || devices.filter((d: any) => d.status === 'active').length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No hay dispositivos MikroTik activos</p>
                      <p className="text-sm">Agrega uno para comenzar</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {isSuperAdmin && <TableHead>Usuario</TableHead>}
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
                        {devices.filter((d: any) => d.status === 'active').map((device: any) => (
                          <TableRow key={device.id}>
                            {isSuperAdmin && (
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm">
                                      {device.profile?.full_name || 'Sin nombre'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {device.profile?.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                            )}
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
            </TabsContent>
            
            {isSuperAdmin && (
              <TabsContent value="all">
                <Card>
                  <CardHeader>
                    <CardTitle>Todos los Dispositivos</CardTitle>
                    <CardDescription>
                      Lista completa de dispositivos con todos los estados
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <div className="text-center py-8">Cargando dispositivos...</div>
                    ) : !devices || devices.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No hay dispositivos MikroTik configurados</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Host</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Puerto</TableHead>
                            <TableHead>Versión</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {devices.map((device: any) => (
                            <TableRow key={device.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm">
                                      {device.profile?.full_name || 'Sin nombre'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {device.profile?.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{device.name}</TableCell>
                              <TableCell>{device.host}</TableCell>
                              <TableCell>{getStatusBadge(device.status)}</TableCell>
                              <TableCell>{device.port}</TableCell>
                              <TableCell>{device.version}</TableCell>
                              <TableCell>
                                {new Date(device.created_at).toLocaleDateString('es-ES')}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  {device.status === 'pending' && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleApprove(device.id)}
                                        disabled={updateDeviceStatusMutation.isPending}
                                      >
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleReject(device.id)}
                                        disabled={updateDeviceStatusMutation.isPending}
                                      >
                                        <XCircle className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDelete(device.id, device.name)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
