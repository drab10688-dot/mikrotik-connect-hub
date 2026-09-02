import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { devicesApi, apiGet } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Shield, Trash2 } from 'lucide-react';

interface VpnPeer {
  id: string;
  name: string;
  peer_address: string;
  mikrotik_id: string | null;
  is_active: boolean;
}

interface L2tpPeer {
  id: string;
  name: string;
  tunnel_ip: string | null;
  is_active: boolean;
}


interface EditDeviceDialogProps {
  device: {
    id: string;
    name: string;
    host: string;
    direct_host?: string | null;
    username: string;
    password: string;
    port: number;
    version: string;
    vpn_peer_id?: string | null;
    vpn_peer_name?: string | null;
  };
  canDelete?: boolean;
  onDeleted?: () => void;
}

export const EditDeviceDialog = ({ device, canDelete = false, onDeleted }: EditDeviceDialogProps) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [vpnPeers, setVpnPeers] = useState<VpnPeer[]>([]);
  const [formData, setFormData] = useState({
    name: device.name,
    host: device.host,
    username: device.username,
    password: device.password,
    port: device.port,
    version: device.version,
    vpn_peer_id: device.vpn_peer_id || null as string | null,
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
        vpn_peer_id: device.vpn_peer_id || null,
      });
      apiGet<VpnPeer[]>('/vpn/peers')
        .then((peers) => setVpnPeers(peers.filter((peer) => peer.is_active && (!peer.mikrotik_id || peer.mikrotik_id === device.id))))
        .catch(() => setVpnPeers([]));
    }
  }, [open, device]);

  const updateDeviceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      await devicesApi.update(device.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-all'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      queryClient.invalidateQueries({ queryKey: ['vpn-peers'] });
      toast.success('Dispositivo actualizado exitosamente');
      setOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar dispositivo');
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: () => devicesApi.delete(device.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-all'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-select'] });
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      queryClient.invalidateQueries({ queryKey: ['vpn-peers'] });
      setDeleteOpen(false);
      setOpen(false);
      onDeleted?.();
      toast.success('Dispositivo eliminado exitosamente');
    },
    onError: (error: any) => toast.error(error.message || 'Error al eliminar dispositivo'),
  });

  const handleVpnPeerSelect = (peerId: string) => {
    if (peerId === 'none') {
      setFormData({ ...formData, vpn_peer_id: null, host: device.direct_host || formData.host });
      return;
    }
    const peer = vpnPeers.find((item) => item.id === peerId);
    if (!peer) return;
    const vpnIp = peer.peer_address.split('/')[0];
    setFormData({ ...formData, vpn_peer_id: peer.id, host: vpnIp });
    toast.info(`Este MikroTik usará la VPN ${peer.name} (${vpnIp})`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateDeviceMutation.mutate(formData);
  };

  const selectedVpn = vpnPeers.find((peer) => peer.id === formData.vpn_peer_id);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" title="Editar dispositivo" aria-label="Editar dispositivo">
            <Pencil className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Editar Dispositivo MikroTik</DialogTitle>
              <DialogDescription>Modifica la configuración y la ruta de acceso del dispositivo</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor={`name-${device.id}`}>Nombre</Label>
                <Input id={`name-${device.id}`} placeholder="MikroTik Principal" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Ruta VPN del MikroTik</Label>
                <Select value={formData.vpn_peer_id || 'none'} onValueChange={handleVpnPeerSelect}>
                  <SelectTrigger><SelectValue placeholder="Sin VPN — IP directa" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin VPN — IP directa</SelectItem>
                    {vpnPeers.map((peer) => <SelectItem key={peer.id} value={peer.id}>{peer.name} ({peer.peer_address.split('/')[0]})</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedVpn || device.vpn_peer_name
                    ? `El panel dirigirá las solicitudes por ${selectedVpn?.name || device.vpn_peer_name} para evitar conflictos de IP local.`
                    : 'Asocia un peer WireGuard para usar su IP única y evitar conflictos entre sedes.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`host-${device.id}`}>Host/IP de conexión</Label>
                <Input id={`host-${device.id}`} placeholder="192.168.1.1" value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`username-${device.id}`}>Usuario</Label>
                  <Input id={`username-${device.id}`} placeholder="admin" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`password-${device.id}`}>Contraseña</Label>
                  <Input id={`password-${device.id}`} type="password" placeholder="••••••••" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`port-${device.id}`}>Puerto API</Label>
                  <Input id={`port-${device.id}`} type="number" value={formData.port} onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 443 })} required />
                  <p className="text-xs text-muted-foreground">443 (HTTPS), 80 (HTTP), 8728, 8730...</p>
                </div>
                <div className="space-y-2">
                  <Label>Versión</Label>
                  <Select value={formData.version} onValueChange={(value) => setFormData({ ...formData, version: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="v7">v7 (REST API)</SelectItem><SelectItem value="v6">v6 (API Legacy)</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              {canDelete ? <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleteDeviceMutation.isPending}><Trash2 className="h-4 w-4" />Eliminar</Button> : <span />}
              <Button type="submit" disabled={updateDeviceMutation.isPending}>{updateDeviceMutation.isPending ? 'Guardando...' : 'Guardar Cambios'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />¿Eliminar dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{device.name}</strong>, sus accesos de usuarios y la asociación VPN. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDeviceMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDeviceMutation.mutate()} disabled={deleteDeviceMutation.isPending} className="bg-destructive hover:bg-destructive/90">
              {deleteDeviceMutation.isPending ? 'Eliminando...' : 'Eliminar dispositivo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
