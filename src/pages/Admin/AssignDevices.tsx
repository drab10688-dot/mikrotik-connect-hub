import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserMikrotikAccess } from '@/hooks/useUserMikrotikAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Plus, Trash2, UserCheck, Shield } from 'lucide-react';

export default function AssignDevices() {
  const { user } = useAuth();
  const {
    adminUsers,
    devices,
    accesses,
    isLoading,
    grantAccess,
    revokeAccess,
    getDevicesByUser,
    isGranting,
    isRevoking,
  } = useUserMikrotikAccess();

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const handleGrantAccess = () => {
    if (!selectedUser || !selectedDevice || !user) {
      return;
    }

    grantAccess({
      userId: selectedUser,
      deviceId: selectedDevice,
      grantedBy: user.id,
    });

    setSelectedDevice("");
  };

  const handleRevokeAccess = (accessId: string, userName: string, deviceName: string) => {
    if (window.confirm(`¿Revocar acceso de ${userName} a ${deviceName}?`)) {
      revokeAccess(accessId);
    }
  };

  const getAvailableDevicesForUser = () => {
    if (!selectedUser || !devices) return [];
    const userDevices = getDevicesByUser(selectedUser);
    const userDeviceIds = new Set(userDevices.map(access => access.mikrotik_id));
    return devices.filter(device => !userDeviceIds.has(device.id));
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-8 ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Asignar Dispositivos</h1>
              <p className="text-muted-foreground">
                Gestiona el acceso de administradores a dispositivos MikroTik
              </p>
            </div>
          </div>

          {/* Asignar nuevo acceso */}
          <Card>
            <CardHeader>
              <CardTitle>Conceder Acceso a Dispositivo</CardTitle>
              <CardDescription>
                Selecciona un administrador y un dispositivo para otorgar acceso
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="text-center py-4">Cargando...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Administrador</label>
                      <Select value={selectedUser} onValueChange={setSelectedUser}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un admin" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminUsers?.map((admin: any) => (
                            <SelectItem key={admin.user_id} value={admin.user_id}>
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-blue-500" />
                                {admin.full_name || admin.email}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Dispositivo MikroTik</label>
                      <Select 
                        value={selectedDevice} 
                        onValueChange={setSelectedDevice}
                        disabled={!selectedUser}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un dispositivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableDevicesForUser().map((device: any) => (
                            <SelectItem key={device.id} value={device.id}>
                              {device.name} ({device.host})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button 
                    onClick={handleGrantAccess}
                    disabled={!selectedUser || !selectedDevice || isGranting}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {isGranting ? 'Concediendo acceso...' : 'Conceder Acceso'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Lista de accesos actuales */}
          <Card>
            <CardHeader>
              <CardTitle>Accesos Activos</CardTitle>
              <CardDescription>
                Administradores con acceso a dispositivos MikroTik
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Cargando accesos...</div>
              ) : !accesses || accesses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay accesos configurados</p>
                  <p className="text-sm">Concede acceso a administradores para comenzar</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Administrador</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Dispositivo</TableHead>
                      <TableHead>Fecha de Acceso</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accesses.map((access: any) => (
                      <TableRow key={access.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-blue-500" />
                            {access.profiles?.full_name || 'Sin nombre'}
                          </div>
                        </TableCell>
                        <TableCell>{access.profiles?.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {access.mikrotik_devices?.name || 'Dispositivo eliminado'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(access.created_at).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => 
                              handleRevokeAccess(
                                access.id,
                                access.profiles?.full_name || access.profiles?.email,
                                access.mikrotik_devices?.name
                              )
                            }
                            disabled={isRevoking}
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
