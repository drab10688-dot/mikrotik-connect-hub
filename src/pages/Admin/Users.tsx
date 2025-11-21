import { useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { UserPlus, Shield, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function UsersAdmin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [deviceToDelete, setDeviceToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      // Primero obtener los perfiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Luego obtener los roles de cada usuario
      const usersWithRoles = await Promise.all(
        profiles.map(async (profile) => {
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', profile.user_id)
            .single();

          return {
            ...profile,
            user_roles: roleData ? [roleData] : []
          };
        })
      );

      return usersWithRoles;
    },
  });

  const { data: devices } = useQuery({
    queryKey: ['mikrotik-devices-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .order('name');

      if (error) throw error;
      return data;
    },
  });

  const { data: accesses } = useQuery({
    queryKey: ['user-mikrotik-accesses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_mikrotik_access')
        .select('*, mikrotik_devices(name)');

      if (error) throw error;
      return data;
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('admin-update-user-role', {
        body: { userId, newRole },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Error al actualizar el rol');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Rol actualizado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar el rol');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Error al eliminar el usuario');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Usuario eliminado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar el usuario');
    },
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
    mutationFn: async ({ userId, deviceId, hasAccess, grantedBy }: { 
      userId: string; 
      deviceId: string; 
      hasAccess: boolean;
      grantedBy: string;
    }) => {
      if (hasAccess) {
        // Revoke access
        const access = accesses?.find(a => a.user_id === userId && a.mikrotik_id === deviceId);
        if (access) {
          const { error } = await supabase
            .from('user_mikrotik_access')
            .delete()
            .eq('id', access.id);
          if (error) throw error;
        }
      } else {
        // Grant access
        const { error } = await supabase
          .from('user_mikrotik_access')
          .insert({
            user_id: userId,
            mikrotik_id: deviceId,
            granted_by: grantedBy,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      toast.success('Acceso actualizado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar el acceso');
    },
  });

  const toggleUserExpansion = (userId: string) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const getUserDeviceAccess = (userId: string, deviceId: string) => {
    return accesses?.some(a => a.user_id === userId && a.mikrotik_id === deviceId) || false;
  };

  const handleToggleAccess = async (userId: string, deviceId: string, hasAccess: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    
    toggleAccessMutation.mutate({
      userId,
      deviceId,
      hasAccess,
      grantedBy: session.user.id,
    });
  };

  const toggleDeviceStatusMutation = useMutation({
    mutationFn: async ({ deviceId, newStatus }: { deviceId: string; newStatus: string }) => {
      const { error } = await supabase
        .from('mikrotik_devices')
        .update({ status: newStatus })
        .eq('id', deviceId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-all'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      toast.success('Estado del dispositivo actualizado');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar estado del dispositivo');
    },
  });

  const handleToggleDeviceStatus = (deviceId: string, newStatus: string) => {
    toggleDeviceStatusMutation.mutate({ deviceId, newStatus });
  };

  const deleteDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      // Primero eliminar todos los accesos de usuarios a este dispositivo
      const { error: accessError } = await supabase
        .from('user_mikrotik_access')
        .delete()
        .eq('mikrotik_id', deviceId);

      if (accessError) throw accessError;

      // Eliminar vouchers asociados
      const { error: voucherError } = await supabase
        .from('vouchers')
        .delete()
        .eq('mikrotik_id', deviceId);

      if (voucherError) throw voucherError;

      // Finalmente eliminar el dispositivo
      const { error: deviceError } = await supabase
        .from('mikrotik_devices')
        .delete()
        .eq('id', deviceId);

      if (deviceError) throw deviceError;
    },
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
      <div className="flex-1 p-8 ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Gestión de Usuarios</h1>
              <p className="text-muted-foreground">
                Administra usuarios y sus roles en el sistema
              </p>
            </div>
            <Button onClick={() => navigate('/admin/register-user')}>
              <UserPlus className="h-4 w-4 mr-2" />
              Registrar Usuario
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios del Sistema</CardTitle>
              <CardDescription>
                Lista de todos los usuarios registrados y sus roles
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Cargando usuarios...</div>
              ) : !users || users.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay usuarios registrados
                </div>
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
                      const userRole = user.user_roles?.[0]?.role;
                      const isAdminRole = userRole === 'admin' || userRole === 'super_admin';
                      
                      // Check if user has any assigned devices OR created devices
                      const userDevices = accesses?.filter(a => a.user_id === user.user_id) || [];
                      const createdDevices = devices?.filter(d => d.created_by === user.user_id) || [];
                      const hasAssignedDevices = userDevices.length > 0;
                      const hasCreatedDevices = createdDevices.length > 0;
                      const shouldShowDevices = isAdminRole || hasAssignedDevices || hasCreatedDevices;
                      
                      return (
                        <Fragment key={user.id}>
                          <TableRow>
                            <TableCell>
                              {shouldShowDevices && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleUserExpansion(user.user_id)}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              {user.full_name || 'Sin nombre'}
                            </TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>
                              <Select
                                value={userRole || 'user'}
                                onValueChange={(value) => handleRoleChange(user.user_id, value)}
                              >
                                <SelectTrigger className="w-[150px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="super_admin">
                                    <div className="flex items-center gap-2">
                                      <Shield className="h-4 w-4 text-red-500" />
                                      Super Admin
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="admin">
                                    <div className="flex items-center gap-2">
                                      <Shield className="h-4 w-4 text-blue-500" />
                                      Admin
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="user">
                                    <div className="flex items-center gap-2">
                                      <UserPlus className="h-4 w-4 text-green-500" />
                                      Usuario
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              {new Date(user.created_at).toLocaleDateString('es-ES')}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteUser(user.user_id, user.full_name || user.email)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          {isExpanded && shouldShowDevices && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/50">
                                <div className="p-4 space-y-2">
                                  <h4 className="font-semibold text-sm mb-3">
                                    {isAdminRole ? 'Acceso a Dispositivos' : 'Mis Dispositivos'}
                                  </h4>
                                  {isAdminRole ? (
                                    // Admin view: show only assigned devices with toggle buttons
                                    userDevices.length > 0 ? (
                                      <div className="grid gap-2">
                                         {userDevices.map((access: any) => {
                                           const device = devices?.find(d => d.id === access.mikrotik_id);
                                           if (!device) return null;
                                           const isCreator = device.created_by === user.user_id;
                                           
                                           return (
                                             <div
                                               key={device.id}
                                               className="flex items-center justify-between p-3 bg-background rounded-lg border"
                                             >
                                               <div className="flex-1">
                                                 <p className="font-medium">{device.name}</p>
                                                 <p className="text-sm text-muted-foreground">{device.host}</p>
                                               </div>
                                               <div className="flex gap-2">
                                                 <Button
                                                   variant="destructive"
                                                   size="sm"
                                                   onClick={() => handleToggleAccess(user.user_id, device.id, true)}
                                                 >
                                                   Desactivar
                                                 </Button>
                                                 {isCreator && (
                                                   <Button
                                                     variant="ghost"
                                                     size="sm"
                                                     onClick={() => setDeviceToDelete({ id: device.id, name: device.name })}
                                                     title="Eliminar dispositivo"
                                                   >
                                                     <Trash2 className="h-4 w-4 text-destructive" />
                                                   </Button>
                                                 )}
                                               </div>
                                             </div>
                                           );
                                         })}
                                       </div>
                                     ) : (
                                       <p className="text-sm text-muted-foreground">No hay dispositivos asignados</p>
                                     )
                                  ) : (
                                    // Regular user view: show created devices with management controls
                                    createdDevices.length > 0 ? (
                                      <div className="grid gap-2">
                                        {createdDevices.map((device: any) => {
                                          return (
                                            <div
                                              key={device.id}
                                              className="flex items-center justify-between p-3 bg-background rounded-lg border"
                                            >
                                              <div className="flex-1">
                                                <p className="font-medium">{device.name}</p>
                                                <p className="text-sm text-muted-foreground">{device.host}</p>
                                              </div>
                                              <div className="flex gap-2 items-center">
                                                {device.status === 'active' ? (
                                                  <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleToggleDeviceStatus(device.id, 'pending')}
                                                  >
                                                    Desactivar
                                                  </Button>
                                                ) : (
                                                  <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={() => handleToggleDeviceStatus(device.id, 'active')}
                                                  >
                                                    Activar
                                                  </Button>
                                                )}
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => setDeviceToDelete({ id: device.id, name: device.name })}
                                                  title="Eliminar dispositivo"
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No has registrado dispositivos</p>
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

      {/* Delete Device Confirmation Dialog */}
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
            <AlertDialogAction
              onClick={() => deviceToDelete && deleteDeviceMutation.mutate(deviceToDelete.id)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar Dispositivo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
