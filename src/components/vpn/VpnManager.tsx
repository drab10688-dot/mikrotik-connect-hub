import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Shield, Plus, Trash2, Download, Copy, RefreshCw, Wifi, WifiOff, Monitor, Network, Server } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";

interface VpnPeer {
  id: string;
  name: string;
  description: string | null;
  mikrotik_id: string | null;
  mikrotik_name: string | null;
  public_key: string;
  peer_address: string;
  remote_networks: string | null;
  is_active: boolean;
  created_at: string;
  live: {
    endpoint: string | null;
    lastHandshake: string | null;
    transferRx: number;
    transferTx: number;
  } | null;
}

interface VpnStatus {
  serverUp: boolean;
  serverPublicKey: string;
  publicIp: string;
  listenPort: string;
  subnet: string;
  peerStatus: Record<string, any>;
}

interface MikrotikDevice {
  id: string;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function timeAgo(date: string | null): string {
  if (!date) return "Nunca";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function VpnManager() {
  const [peers, setPeers] = useState<VpnPeer[]>([]);
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [devices, setDevices] = useState<MikrotikDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<{ clientConfig: string; mikrotikScript: string; peer: any } | null>(null);
  const [newPeer, setNewPeer] = useState({ name: "", description: "", mikrotik_id: "", remote_networks: "" });

  const fetchData = useCallback(async () => {
    try {
      const [peersRes, statusRes, devicesRes] = await Promise.all([
        apiGet("/vpn/peers"),
        apiGet("/vpn/status"),
        apiGet("/devices"),
      ]);
      setPeers(peersRes);
      setStatus(statusRes);
      setDevices(devicesRes);
    } catch (err: any) {
      console.error("VPN fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleInitServer = async () => {
    try {
      await apiPost("/vpn/init", {});
      toast.success("WireGuard inicializado");
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddPeer = async () => {
    if (!newPeer.name.trim()) return toast.error("Nombre requerido");
    try {
      const result = await apiPost("/vpn/peers", {
        name: newPeer.name,
        description: newPeer.description || undefined,
        mikrotik_id: newPeer.mikrotik_id || undefined,
        remote_networks: newPeer.remote_networks || undefined,
      });
      toast.success("Peer VPN creado");
      setAddOpen(false);
      setNewPeer({ name: "", description: "", mikrotik_id: "", remote_networks: "" });
      setSelectedConfig(result);
      setConfigOpen(true);
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleTogglePeer = async (peer: VpnPeer) => {
    try {
      await apiPut(`/vpn/peers/${peer.id}`, { is_active: !peer.is_active });
      toast.success(peer.is_active ? "Peer desactivado" : "Peer activado");
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeletePeer = async (peer: VpnPeer) => {
    if (!confirm(`¿Eliminar peer "${peer.name}"?`)) return;
    try {
      await apiDelete(`/vpn/peers/${peer.id}`);
      toast.success("Peer eliminado");
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleShowConfig = async (peer: VpnPeer) => {
    try {
      const result = await apiGet(`/vpn/peers/${peer.id}/config`);
      setSelectedConfig(result);
      setConfigOpen(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando VPN...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Server Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-lg">WireGuard VPN</CardTitle>
                <CardDescription>Acceso remoto seguro a redes MikroTik</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={status?.serverUp ? "default" : "destructive"} className="gap-1">
                {status?.serverUp ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {status?.serverUp ? "Activo" : "Inactivo"}
              </Badge>
              <Button size="sm" variant="outline" onClick={fetchData}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        {status && (
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">IP Pública:</span>
                <p className="font-mono font-medium">{status.publicIp || "N/A"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Puerto:</span>
                <p className="font-mono font-medium">{status.listenPort}/UDP</p>
              </div>
              <div>
                <span className="text-muted-foreground">Subred:</span>
                <p className="font-mono font-medium">{status.subnet}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Peers:</span>
                <p className="font-medium">{peers.length} configurados</p>
              </div>
            </div>
            {!status.serverUp && (
              <Button className="mt-4" onClick={handleInitServer}>
                <Server className="h-4 w-4 mr-2" />
                Inicializar WireGuard
              </Button>
            )}
          </CardContent>
        )}
      </Card>

      {/* Peers */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Peers VPN</CardTitle>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Peer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuevo Peer VPN</DialogTitle>
                  <DialogDescription>
                    Crea un túnel WireGuard para acceder a una red MikroTik remota
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Nombre *</Label>
                    <Input
                      placeholder="Ej: MikroTik Oficina Central"
                      value={newPeer.name}
                      onChange={(e) => setNewPeer({ ...newPeer, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Descripción</Label>
                    <Input
                      placeholder="Ej: Router principal de la oficina"
                      value={newPeer.description}
                      onChange={(e) => setNewPeer({ ...newPeer, description: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>MikroTik asociado (opcional)</Label>
                    <Select value={newPeer.mikrotik_id} onValueChange={(v) => setNewPeer({ ...newPeer, mikrotik_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asociar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin asociar</SelectItem>
                        {devices.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Redes remotas (opcional)</Label>
                    <Input
                      placeholder="Ej: 192.168.1.0/24, 10.0.0.0/24"
                      value={newPeer.remote_networks}
                      onChange={(e) => setNewPeer({ ...newPeer, remote_networks: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Subredes detrás de la MikroTik a las que quieres acceder
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
                  <Button onClick={handleAddPeer}>Crear Peer</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {peers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Network className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No hay peers VPN configurados</p>
              <p className="text-sm">Agrega un peer para conectar una MikroTik remota</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>IP VPN</TableHead>
                    <TableHead>MikroTik</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Tráfico</TableHead>
                    <TableHead>Último handshake</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peers.map((peer) => {
                    const isOnline = peer.live?.lastHandshake && (Date.now() - new Date(peer.live.lastHandshake).getTime()) < 180000;
                    return (
                      <TableRow key={peer.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{peer.name}</p>
                            {peer.description && (
                              <p className="text-xs text-muted-foreground">{peer.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{peer.peer_address}</TableCell>
                        <TableCell>
                          {peer.mikrotik_name ? (
                            <Badge variant="outline">{peer.mikrotik_name}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : peer.is_active ? 'bg-yellow-500' : 'bg-destructive'}`} />
                            <span className="text-sm">
                              {isOnline ? 'Conectado' : peer.is_active ? 'Esperando' : 'Desactivado'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {peer.live ? (
                            <span className="font-mono">
                              ↑{formatBytes(peer.live.transferTx)} ↓{formatBytes(peer.live.transferRx)}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {peer.live?.lastHandshake ? timeAgo(peer.live.lastHandshake) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Switch
                              checked={peer.is_active}
                              onCheckedChange={() => handleTogglePeer(peer)}
                            />
                            <Button size="icon" variant="ghost" onClick={() => handleShowConfig(peer)} title="Ver configuración">
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDeletePeer(peer)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config Dialog */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configuración del Peer</DialogTitle>
            <DialogDescription>
              Usa estas configuraciones para conectar tu dispositivo
            </DialogDescription>
          </DialogHeader>
          {selectedConfig && (
            <Tabs defaultValue="mikrotik" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="mikrotik">MikroTik RouterOS</TabsTrigger>
                <TabsTrigger value="standard">Config Estándar</TabsTrigger>
              </TabsList>

              <TabsContent value="mikrotik" className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Script MikroTik (RouterOS v7)</Label>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(selectedConfig.mikrotikScript, "Script MikroTik")}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar
                  </Button>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                    {selectedConfig.mikrotikScript}
                  </pre>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-3 rounded-md">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">📋 Instrucciones:</p>
                  <ol className="text-xs text-blue-700 dark:text-blue-400 mt-2 space-y-1 list-decimal list-inside">
                    <li>Abre el terminal de tu MikroTik (Winbox → New Terminal)</li>
                    <li>Pega el script completo y presiona Enter</li>
                    <li>Verifica la conexión: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">/interface wireguard peers print</code></li>
                    <li>Para acceder a equipos detrás de la MikroTik, agrega rutas estáticas en el VPS</li>
                  </ol>
                </div>
              </TabsContent>

              <TabsContent value="standard" className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Configuración WireGuard (.conf)</Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(selectedConfig.clientConfig, "Configuración")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copiar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const blob = new Blob([selectedConfig.clientConfig], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${selectedConfig.peer?.name || "peer"}.conf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar .conf
                    </Button>
                  </div>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                    {selectedConfig.clientConfig}
                  </pre>
                </div>
                <p className="text-xs text-muted-foreground">
                  Compatible con WireGuard para Windows, macOS, Linux, Android e iOS.
                </p>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
