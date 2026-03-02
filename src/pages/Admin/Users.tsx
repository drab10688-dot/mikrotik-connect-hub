import { useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, devicesApi, getStoredUser } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { UserPlus, Shield, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { apiGet, apiPost, apiDelete, apiPut } from '@/lib/api-client';

export default function UsersAdmin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [deviceToDelete, setDeviceToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => usersApi.list(),
  });

  const { data: devices } = useQuery({
    queryKey: ['mikrotik-devices-all'],
    queryFn: () => devicesApi.list(),
  });

  const { data: accesses } = useQuery({
    queryKey: ['user-mikrotik-accesses'],
    queryFn: () => apiGet<any[]>('/devices/accesses'),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, newRole }: { userId: string; newRole: string }) =>
      usersApi.updateRole(userId, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Rol actualizado exitosamente');
    },
    onError: (error: any) => toast.error(error.message || 'Error al actualizar el rol'),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => usersApi.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Usuario eliminado exitosamente');
    },
    onError: (error: any) => toast.error(error.message || 'Error al eliminar el usuario'),
  });

  const getRoleBadge = (role: string) => {
    const colors = {
      super_admin: 'bg-red-500',
      admin: 'bg-blue-500',
      user: 'bg-green-500',
    };
    return colors[role as keyof typeof colors] || 'bg-gray-500';
  };

  const handleRoleChange = (userId: string, newRole: string) => {
    updateRoleMutation.mutate({ userId, newRole });
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    if (window.confirm(`¿Estás seguro de eliminar al usuario "${userName}"?`)) {
      deleteUserMutation.mutate(userId);
    }
  };

  const toggleAccessMutation = useMutation({
    mutationFn: async ({ userId, deviceId, hasAccess }: { userId: string; deviceId: string; hasAccess: boolean }) => {
      if (hasAccess) {
        const access = accesses?.find((a: any) => a.user_id === userId && a.mikrotik_id === deviceId);
        if (access) await apiDelete(`/devices/accesses/${access.id}`);
      } else {
        const currentUser = getStoredUser();
        await apiPost('/devices/accesses', { user_id: userId, mikrotik_id: deviceId, granted_by: currentUser?.id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      toast.success('Acceso actualizado exitosamente');
    },
    onError: (error: any) => toast.error(error.message || 'Error al actualizar el acceso'),
  });

  const toggleUserExpansion = (userId: string) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) newSet.delete(userId);
      else newSet.add(userId);
      return newSet;
    });
  };

  const getUserDeviceAccess = (userId: string, deviceId: string) => {
    return accesses?.some((a: any) => a.user_id === userId && a.mikrotik_id === deviceId) || false;
  };

  const handleToggleAccess = (userId: string, deviceId: string, hasAccess: boolean) => {
    toggleAccessMutation.mutate({ userId, deviceId, hasAccess });
  };

  const toggleDeviceStatusMutation = useMutation({
    mutationFn: ({ deviceId, newStatus }: { deviceId: string; newStatus: string }) =>
      devicesApi.update(deviceId, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-all'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      toast.success('Estado del dispositivo actualizado');
    },
    onError: (error: any) => toast.error(error.message || 'Error al actualizar estado del dispositivo'),
  });

  const handleToggleDeviceStatus = (deviceId: string, newStatus: string) => {
    toggleDeviceStatusMutation.mutate({ deviceId, newStatus });
  };

  const deleteDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => devicesApi.delete(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-all'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      toast.success('Dispositivo eliminado exitosamente');
      setDeviceToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar dispositivo');
      setDeviceToDelete(null);
    },
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Gestión de Usuarios</h1>
              <p className="text-muted-foreground">Administra usuarios y sus roles en el sistema</p>
            </div>
            <Button onClick={() => navigate('/admin/register-user')}>
              <UserPlus className="h-4 w-4 mr-2" />
              Registrar Usuario
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios del Sistema</CardTitle>
              <CardDescription>Lista de todos los usuarios registrados y sus roles</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Cargando usuarios...</div>
              ) : !users || users.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No hay usuarios registrados</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Fecha de Registro</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user: any) => {
                      const isExpanded = expandedUsers.has(user.user_id);
                      const userRole = user.user_roles?.[0]?.role || user.role;
                      const isAdminRole = userRole === 'admin' || userRole === 'super_admin';
                      const userDevices = accesses?.filter((a: any) => a.user_id === user.user_id) || [];
                      const createdDevices = devices?.filter((d: any) => d.created_by === user.user_id) || [];
                      const hasAssignedDevices = userDevices.length > 0;
                      const hasCreatedDevices = createdDevices.length > 0;
                      const hasActiveCreatedDevices = createdDevices.filter((d: any) => d.status === 'active').length > 0;
                      const shouldShowDevices = isAdminRole ? (hasAssignedDevices || hasCreatedDevices) : hasActiveCreatedDevices;

                      return (
                        <Fragment key={user.id}>
                          <TableRow>
                            <TableCell>
                              {shouldShowDevices && (
                                <Button variant="ghost" size="sm" onClick={() => toggleUserExpansion(user.user_id)}>
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{user.full_name || 'Sin nombre'}</TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>
                              <Select value={userRole || 'user'} onValueChange={(value) => handleRoleChange(user.user_id, value)}>
                                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="super_admin"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-red-500" />Super Admin</div></SelectItem>
                                  <SelectItem value="admin"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-blue-500" />Admin</div></SelectItem>
                                  <SelectItem value="user"><div className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-green-500" />Usuario</div></SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>{new Date(user.created_at).toLocaleDateString('es-ES')}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(user.user_id, user.full_name || user.email)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          {isExpanded && shouldShowDevices && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/50">
                                <div className="p-4 space-y-2">
                                  <h4 className="font-semibold text-sm mb-3">{isAdminRole ? 'Acceso a Dispositivos' : 'Mis Dispositivos'}</h4>
                                  {isAdminRole ? (
                                    userDevices.length > 0 || createdDevices.length > 0 ? (
                                      <div className="grid gap-2">
                                        {userDevices.map((access: any) => {
                                          const device = devices?.find((d: any) => d.id === access.mikrotik_id);
                                          if (!device) return null;
                                          const isCreator = device.created_by === user.user_id;
                                          const isPending = device.status === 'pending';
                                          return (
                                            <div key={device.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                                              <div className="flex-1">
                                                <p className="font-medium">{device.name}</p>
                                                <p className="text-sm text-muted-foreground">{device.host}</p>
                                                {isPending && <Badge variant="outline" className="mt-1 text-yellow-600">Pendiente de autorización</Badge>}
                                              </div>
                                              <div className="flex gap-2">
                                                {isPending ? (
                                                  <Button variant="default" size="sm" onClick={() => handleToggleDeviceStatus(device.id, 'active')}>Activar</Button>
                                                ) : (
                                                  <>
                                                    <Button variant="outline" size="sm" onClick={() => handleToggleDeviceStatus(device.id, 'pending')}>Desactivar dispositivo</Button>
                                                    <Button variant="destructive" size="sm" onClick={() => handleToggleAccess(user.user_id, device.id, true)}>Remover acceso</Button>
                                                  </>
                                                )}
                                                {isCreator && (
                                                  <Button variant="ghost" size="sm" onClick={() => setDeviceToDelete({ id: device.id, name: device.name })} title="Eliminar dispositivo">
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                  </Button>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                        {createdDevices.filter((device: any) => !userDevices.some((a: any) => a.mikrotik_id === device.id)).map((device: any) => (
                                          <div key={device.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                                            <div className="flex-1">
                                              <p className="font-medium">{device.name}</p>
                                              <p className="text-sm text-muted-foreground">{device.host}</p>
                                            </div>
                                            <div className="flex gap-2 items-center">
                                              {device.status === 'active' ? (
                                                <Button variant="destructive" size="sm" onClick={() => handleToggleDeviceStatus(device.id, 'pending')}>Desactivar</Button>
                                              ) : (
                                                <Button variant="default" size="sm" onClick={() => handleToggleDeviceStatus(device.id, 'active')}>Activar</Button>
                                              )}
                                              <Button variant="ghost" size="sm" onClick={() => setDeviceToDelete({ id: device.id, name: device.name })} title="Eliminar dispositivo">
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : <p className="text-sm text-muted-foreground">No hay dispositivos asignados</p>
                                  ) : (
                                    createdDevices.filter((d: any) => d.status === 'active').length > 0 ? (
                                      <div className="grid gap-2">
                                        {createdDevices.filter((d: any) => d.status === 'active').map((device: any) => (
                                          <div key={device.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                                            <div className="flex-1">
                                              <p className="font-medium">{device.name}</p>
                                              <p className="text-sm text-muted-foreground">{device.host}</p>
                                            </div>
                                            <div className="flex gap-2 items-center">
                                              <Button variant="ghost" size="sm" onClick={() => setDeviceToDelete({ id: device.id, name: device.name })} title="Eliminar dispositivo">
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">
                                        {createdDevices.length > 0 ? 'Tus dispositivos están pendientes de autorización por el administrador' : 'No has registrado dispositivos'}
                                      </p>
                                    )
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={!!deviceToDelete} onOpenChange={() => setDeviceToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ¿Eliminar dispositivo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Estás a punto de eliminar el dispositivo <strong>{deviceToDelete?.name}</strong>.
              <br /><br />
              Esta acción:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Eliminará todos los accesos de usuarios a este dispositivo</li>
                <li>Eliminará todos los vouchers asociados</li>
                <li>No se puede deshacer</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deviceToDelete && deleteDeviceMutation.mutate(deviceToDelete.id)} className="bg-destructive hover:bg-destructive/90">
              Eliminar Dispositivo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
