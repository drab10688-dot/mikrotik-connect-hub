import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mikrotikCommandApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getSelectedDeviceId, getSelectedDevice } from '@/lib/mikrotik';
import { Plus, Trash2, Wifi, Router } from 'lucide-react';
import { toast } from 'sonner';

export default function HotspotProfiles() {
  const navigate = useNavigate();
  const connectedDeviceId = getSelectedDeviceId();
  const connectedDevice = getSelectedDevice();
  const selectedMikrotik = connectedDeviceId || "";
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [sharedUsers, setSharedUsers] = useState("1");
  const [rateLimit, setRateLimit] = useState("");
  const [sessionTimeout, setSessionTimeout] = useState("");
  const [idleTimeout, setIdleTimeout] = useState("");
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['hotspot-profiles-manage', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return [];
      const data = await mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profiles');
      return data?.data || [];
    },
    enabled: !!selectedMikrotik,
  });

  const createProfileMutation = useMutation({
    mutationFn: async () => {
      const profileData: any = { name: profileName, 'shared-users': sharedUsers };
      if (rateLimit) profileData['rate-limit'] = rateLimit;
      if (sessionTimeout) profileData['session-timeout'] = sessionTimeout;
      if (idleTimeout) profileData['idle-timeout'] = idleTimeout;
      await mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profile-add', profileData);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] }); toast.success('Perfil creado exitosamente'); setShowCreateDialog(false); resetForm(); },
    onError: (error: any) => toast.error(error.message || 'Error al crear perfil'),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profile-delete', { '.id': profileId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] }); toast.success('Perfil eliminado exitosamente'); setDeleteProfileId(null); },
    onError: (error: any) => toast.error(error.message || 'Error al eliminar perfil'),
  });

  const resetForm = () => { setProfileName(""); setSharedUsers("1"); setRateLimit(""); setSessionTimeout(""); setIdleTimeout(""); };
  const handleCreate = () => { if (!profileName.trim()) { toast.error('Nombre requerido'); return; } createProfileMutation.mutate(); };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div><h1 className="text-3xl font-bold flex items-center gap-2"><Wifi className="h-8 w-8" />Perfiles Hotspot</h1><p className="text-muted-foreground">Gestiona los perfiles de conexión de tus dispositivos MikroTik</p></div>
          {!selectedMikrotik ? (
            <Card><CardContent className="py-8 text-center"><Router className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground mb-4">No hay dispositivo MikroTik conectado</p><Button onClick={() => navigate('/settings')}>Ir a Configuración</Button></CardContent></Card>
          ) : (
            <>
              <Card><CardHeader className="pb-3"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/10"><Router className="h-5 w-5 text-primary" /></div><div><CardTitle className="text-lg">{connectedDevice?.name}</CardTitle><CardDescription>{connectedDevice?.host}:{connectedDevice?.port}</CardDescription></div></div><Button variant="outline" size="sm" onClick={() => navigate('/settings')}>Cambiar</Button></div></CardHeader></Card>
              {showCreateDialog ? (
                <Card><CardHeader><CardTitle>Crear Nuevo Perfil</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-2"><Label>Nombre del Perfil *</Label><Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="5mbps-1hora" /></div><div className="space-y-2"><Label>Usuarios Compartidos</Label><Input type="number" value={sharedUsers} onChange={(e) => setSharedUsers(e.target.value)} /></div><div className="space-y-2"><Label>Límite de Velocidad</Label><Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="5M/5M" /></div><div className="space-y-2"><Label>Tiempo de Sesión</Label><Input value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} placeholder="1h" /></div><div className="space-y-2"><Label>Tiempo Inactivo</Label><Input value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} placeholder="5m" /></div></div><div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>Cancelar</Button><Button onClick={handleCreate} disabled={createProfileMutation.isPending}>{createProfileMutation.isPending ? 'Creando...' : 'Crear Perfil'}</Button></div></CardContent></Card>
              ) : <div className="flex justify-end"><Button onClick={() => setShowCreateDialog(true)}><Plus className="h-4 w-4 mr-2" />Crear Perfil</Button></div>}
              <Card><CardHeader><CardTitle>Perfiles Configurados</CardTitle></CardHeader><CardContent>
                {isLoading ? <div className="text-center py-8 text-muted-foreground">Cargando perfiles...</div>
                : profiles.length === 0 ? <div className="text-center py-8 text-muted-foreground">No hay perfiles configurados</div>
                : <Table><TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Usuarios Compartidos</TableHead><TableHead>Límite de Velocidad</TableHead><TableHead>Tiempo Sesión</TableHead><TableHead>Tiempo Inactivo</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{profiles.map((profile: any) => (<TableRow key={profile['.id']}><TableCell className="font-medium">{profile.name}</TableCell><TableCell>{profile['shared-users'] || '1'}</TableCell><TableCell>{profile['rate-limit'] || 'Sin límite'}</TableCell><TableCell>{profile['session-timeout'] || 'Sin límite'}</TableCell><TableCell>{profile['idle-timeout'] || 'Sin límite'}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setDeleteProfileId(profile['.id'])} disabled={profile.name === 'default'}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell></TableRow>))}</TableBody></Table>}
              </CardContent></Card>
            </>
          )}
        </div>
      </div>
      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar perfil?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteProfileId && deleteProfileMutation.mutate(deleteProfileId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
