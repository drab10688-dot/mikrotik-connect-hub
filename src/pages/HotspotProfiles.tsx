import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useUserDeviceAccess } from '@/hooks/useUserDeviceAccess';
import { Plus, Trash2, Wifi } from 'lucide-react';
import { toast } from 'sonner';

export default function HotspotProfiles() {
  const [selectedMikrotik, setSelectedMikrotik] = useState<string>("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  
  // Form state
  const [profileName, setProfileName] = useState("");
  const [sharedUsers, setSharedUsers] = useState("1");
  const [rateLimit, setRateLimit] = useState("");
  const [sessionTimeout, setSessionTimeout] = useState("");
  const [idleTimeout, setIdleTimeout] = useState("");

  const queryClient = useQueryClient();
  const { devices: mikrotikDevices } = useUserDeviceAccess();

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['hotspot-profiles-manage', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return [];
      
      const { data: device } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', selectedMikrotik)
        .single();
      
      if (!device) return [];
      
      const functionName = device.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === 'v7' ? undefined : 'hotspot-profiles',
          action: device.version === 'v7' ? 'list-profiles' : undefined,
        },
      });
      
      if (error) throw error;
      return data?.data || [];
    },
    enabled: !!selectedMikrotik,
  });

  const createProfileMutation = useMutation({
    mutationFn: async () => {
      const { data: device } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', selectedMikrotik)
        .single();
      
      if (!device) throw new Error('Dispositivo no encontrado');
      
      const functionName = device.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      
      const profileData: any = {
        name: profileName,
        'shared-users': sharedUsers,
      };

      if (rateLimit) profileData['rate-limit'] = rateLimit;
      if (sessionTimeout) profileData['session-timeout'] = sessionTimeout;
      if (idleTimeout) profileData['idle-timeout'] = idleTimeout;

      const { error } = await supabase.functions.invoke(functionName, {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === 'v7' ? undefined : 'hotspot-profile-add',
          action: device.version === 'v7' ? 'add-profile' : undefined,
          params: profileData,
        },
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] });
      toast.success('Perfil creado exitosamente');
      setShowCreateDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al crear perfil');
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const { data: device } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', selectedMikrotik)
        .single();
      
      if (!device) throw new Error('Dispositivo no encontrado');
      
      const functionName = device.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      
      const { error } = await supabase.functions.invoke(functionName, {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === 'v7' ? undefined : 'hotspot-profile-delete',
          action: device.version === 'v7' ? 'remove-profile' : undefined,
          params: { '.id': profileId },
        },
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] });
      toast.success('Perfil eliminado exitosamente');
      setDeleteProfileId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar perfil');
    },
  });

  const resetForm = () => {
    setProfileName("");
    setSharedUsers("1");
    setRateLimit("");
    setSessionTimeout("");
    setIdleTimeout("");
  };

  const handleCreate = () => {
    if (!profileName.trim()) {
      toast.error('El nombre del perfil es requerido');
      return;
    }
    createProfileMutation.mutate();
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Wifi className="h-8 w-8" />
                Perfiles Hotspot
              </h1>
              <p className="text-muted-foreground">
                Gestiona los perfiles de conexión de tus dispositivos MikroTik
              </p>
            </div>
          </div>

          {/* Device Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Seleccionar Dispositivo</CardTitle>
              <CardDescription>Elige el MikroTik para gestionar perfiles</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedMikrotik} onValueChange={setSelectedMikrotik}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un dispositivo" />
                </SelectTrigger>
                <SelectContent>
                  {mikrotikDevices?.map((device: any) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} ({device.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedMikrotik && (
            <>
              {/* Create Profile Section */}
              {showCreateDialog ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Crear Nuevo Perfil</CardTitle>
                    <CardDescription>Define la configuración del perfil hotspot</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Nombre del Perfil *</Label>
                        <Input
                          id="name"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          placeholder="Ej: 5mbps-1hora"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="shared">Usuarios Compartidos</Label>
                        <Input
                          id="shared"
                          type="number"
                          value={sharedUsers}
                          onChange={(e) => setSharedUsers(e.target.value)}
                          placeholder="1"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="rate">Límite de Velocidad</Label>
                        <Input
                          id="rate"
                          value={rateLimit}
                          onChange={(e) => setRateLimit(e.target.value)}
                          placeholder="Ej: 5M/5M"
                        />
                        <p className="text-xs text-muted-foreground">
                          Formato: upload/download (Ej: 5M/10M)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="session">Tiempo de Sesión</Label>
                        <Input
                          id="session"
                          value={sessionTimeout}
                          onChange={(e) => setSessionTimeout(e.target.value)}
                          placeholder="Ej: 1h, 30m, 1d"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="idle">Tiempo Inactivo</Label>
                        <Input
                          id="idle"
                          value={idleTimeout}
                          onChange={(e) => setIdleTimeout(e.target.value)}
                          placeholder="Ej: 5m, 10m"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowCreateDialog(false);
                          resetForm();
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleCreate}
                        disabled={createProfileMutation.isPending}
                      >
                        {createProfileMutation.isPending ? 'Creando...' : 'Crear Perfil'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex justify-end">
                  <Button onClick={() => setShowCreateDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Crear Perfil
                  </Button>
                </div>
              )}

              {/* Profiles Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Perfiles Configurados</CardTitle>
                  <CardDescription>
                    Lista de perfiles hotspot disponibles
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Cargando perfiles...
                    </div>
                  ) : profiles.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No hay perfiles configurados
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nombre</TableHead>
                          <TableHead>Usuarios Compartidos</TableHead>
                          <TableHead>Límite de Velocidad</TableHead>
                          <TableHead>Tiempo Sesión</TableHead>
                          <TableHead>Tiempo Inactivo</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profiles.map((profile: any) => (
                          <TableRow key={profile['.id']}>
                            <TableCell className="font-medium">{profile.name}</TableCell>
                            <TableCell>{profile['shared-users'] || '1'}</TableCell>
                            <TableCell>{profile['rate-limit'] || 'Sin límite'}</TableCell>
                            <TableCell>{profile['session-timeout'] || 'Sin límite'}</TableCell>
                            <TableCell>{profile['idle-timeout'] || 'Sin límite'}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteProfileId(profile['.id'])}
                                disabled={profile.name === 'default'}
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
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar perfil?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El perfil será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteProfileId && deleteProfileMutation.mutate(deleteProfileId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
