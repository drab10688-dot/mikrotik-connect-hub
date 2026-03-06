import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut, apiDelete, devicesApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import {
  Radio, RefreshCw, Wifi, Signal, Activity, Cpu, RotateCcw, Eye,
  Users, Clock, Server, Filter, Plus, Settings2, Trash2, Edit, AlertTriangle, ChevronDown
} from "lucide-react";

// ─── Types ──────────────────────────────────────
interface UnifiedAntenna {
  id: string;
  name: string;
  host: string;
  brand: "mikrotik" | "ubiquiti";
  status?: "online" | "offline" | "no_credentials" | "pending";
  signal?: number | null;
  noise?: number | null;
  ccq?: number | null;
  uptime?: string;
  cpu?: number;
  connected_clients?: number;
  board?: string;
  version?: string;
  model?: string;
  ubiquiti_id?: string;
  last_seen?: string | null;
  client_name?: string;
}

// ─── Brand config ───────────────────────────────
const brandConfig = {
  mikrotik: { label: "MikroTik", color: "bg-sky-600", icon: "🔵" },
  ubiquiti: { label: "Ubiquiti", color: "bg-emerald-600", icon: "🟢" },
};

function signalColor(signal: number | null | undefined) {
  if (signal == null) return "text-muted-foreground";
  const abs = Math.abs(signal);
  if (abs <= 60) return "text-green-500";
  if (abs <= 70) return "text-yellow-500";
  if (abs <= 80) return "text-orange-500";
  return "text-red-500";
}

function signalBadge(signal: number | null | undefined) {
  if (signal == null) return <Badge variant="outline" className="text-xs">Sin datos</Badge>;
  const abs = Math.abs(signal);
  if (abs <= 60) return <Badge className="bg-green-600 text-xs">Excelente</Badge>;
  if (abs <= 70) return <Badge className="bg-yellow-600 text-xs">Buena</Badge>;
  if (abs <= 80) return <Badge className="bg-orange-600 text-xs">Regular</Badge>;
  return <Badge variant="destructive" className="text-xs">Débil</Badge>;
}

// ─── Forms ──────────────────────────────────────
const emptyMkForm = { name: "", host: "", username: "admin", password: "", port: 443, version: "v7", hotspot_url: "" };
const emptyUbForm = { name: "", ip_address: "", username: "", password: "", model: "", mac_address: "", notes: "" };
const emptyConfigForm = { default_username: "ubnt", default_password: "" };

export function AntennasDashboard() {
  const { user, isSuperAdmin } = useAuth();
  const [antennas, setAntennas] = useState<UnifiedAntenna[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("all");

  // Dialogs
  const [showAddMk, setShowAddMk] = useState(false);
  const [showAddUb, setShowAddUb] = useState(false);
  const [showUbConfig, setShowUbConfig] = useState(false);
  const [editUb, setEditUb] = useState<UnifiedAntenna | null>(null);

  // Forms
  const [mkForm, setMkForm] = useState(emptyMkForm);
  const [ubForm, setUbForm] = useState(emptyUbForm);
  const [configForm, setConfigForm] = useState(emptyConfigForm);
  const [hasGlobalConfig, setHasGlobalConfig] = useState(false);

  // Detail
  const [detailAntenna, setDetailAntenna] = useState<UnifiedAntenna | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const unified: UnifiedAntenna[] = [];

    try {
      const mkDevices = await apiGet("/antennas/devices");
      for (const d of mkDevices) {
        unified.push({ id: d.id, name: d.name, host: d.host, brand: "mikrotik", version: d.version, status: d.status === "active" ? undefined : "pending" });
      }
    } catch { /* ignore */ }

    try {
      const ubDevices = await apiGet("/ubiquiti/devices");
      for (const d of ubDevices) {
        unified.push({
          id: `ub-${d.id}`, ubiquiti_id: d.id, name: d.name, host: d.ip_address, brand: "ubiquiti",
          model: d.model, signal: d.last_signal, noise: d.last_noise, ccq: d.last_ccq,
          last_seen: d.last_seen, client_name: d.client_name,
        });
      }
    } catch { /* ignore */ }

    setAntennas(unified);
    setLoading(false);
  }, []);

  const loadUbConfig = useCallback(async () => {
    try {
      const data = await apiGet("/ubiquiti/config");
      if (data) { setHasGlobalConfig(true); setConfigForm({ default_username: data.default_username || "ubnt", default_password: "" }); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAll(); loadUbConfig(); }, [loadAll, loadUbConfig]);

  // ─── Refresh ──────────────────────────────────
  const refreshAllStatuses = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setRefreshing(true);

    let syncedMikrotik = false;
    let syncedUbiquiti = false;
    let firstErrorMessage = "";

    try {
      const mkStatuses = await apiGet("/antennas/status/all");
      setAntennas((prev) => prev.map((a) => {
        if (a.brand !== "mikrotik") return a;
        const st = mkStatuses.find((s: any) => s.id === a.id);
        return st ? { ...a, status: st.status, signal: st.signal, noise: st.noise, ccq: st.ccq, uptime: st.uptime, cpu: st.cpu, connected_clients: st.connected_clients, board: st.board, version: st.version || a.version, name: st.name || a.name } : a;
      }));
      syncedMikrotik = true;
    } catch (e: any) {
      firstErrorMessage ||= e?.message || "Error al consultar antenas MikroTik";
    }

    try {
      const ubStatuses = await apiGet("/ubiquiti/devices/status/all");
      setAntennas((prev) => prev.map((a) => {
        if (a.brand !== "ubiquiti") return a;
        const st = ubStatuses.find((s: any) => `ub-${s.id}` === a.id);
        return st ? { ...a, status: st.status, signal: st.signal, noise: st.noise, ccq: st.ccq, uptime: st.uptime, cpu: st.cpu } : a;
      }));
      syncedUbiquiti = true;
    } catch (e: any) {
      firstErrorMessage ||= e?.message || "Error al consultar antenas Ubiquiti";
    }

    if (!silent) {
      if (syncedMikrotik || syncedUbiquiti) {
        toast.success("Señales actualizadas");
      } else {
        toast.error(firstErrorMessage || "Error al sincronizar señales");
      }
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!antennas.length) return;

    void refreshAllStatuses({ silent: true });
    const intervalId = window.setInterval(() => {
      void refreshAllStatuses({ silent: true });
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [antennas.length, refreshAllStatuses]);

  // ─── Add MikroTik ────────────────────────────
  const handleAddMk = async () => {
    if (!mkForm.name || !mkForm.host || !mkForm.username || !mkForm.password) { toast.error("Completa todos los campos requeridos"); return; }
    try {
      await devicesApi.create({ ...mkForm, created_by: user?.id });
      toast.success(isSuperAdmin ? "MikroTik agregado" : "Dispositivo enviado para aprobación");
      setShowAddMk(false);
      setMkForm(emptyMkForm);
      loadAll();
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Add Ubiquiti ─────────────────────────────
  const handleAddUb = async () => {
    if (!ubForm.name || !ubForm.ip_address) { toast.error("Nombre e IP son requeridos"); return; }
    try {
      await apiPost("/ubiquiti/devices", ubForm);
      toast.success("Equipo Ubiquiti agregado");
      setShowAddUb(false);
      setUbForm(emptyUbForm);
      loadAll();
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Edit Ubiquiti ────────────────────────────
  const handleEditUb = async () => {
    if (!editUb?.ubiquiti_id) return;
    try {
      await apiPut(`/ubiquiti/devices/${editUb.ubiquiti_id}`, ubForm);
      toast.success("Equipo actualizado");
      setEditUb(null);
      setUbForm(emptyUbForm);
      loadAll();
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Delete Ubiquiti ──────────────────────────
  const handleDeleteUb = async (ant: UnifiedAntenna) => {
    if (!ant.ubiquiti_id || !confirm(`¿Eliminar ${ant.name}?`)) return;
    try {
      await apiDelete(`/ubiquiti/devices/${ant.ubiquiti_id}`);
      toast.success("Equipo eliminado");
      loadAll();
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Save Ubiquiti Config ─────────────────────
  const handleSaveConfig = async () => {
    if (!configForm.default_username || !configForm.default_password) { toast.error("Usuario y contraseña requeridos"); return; }
    try {
      await apiPut("/ubiquiti/config", configForm);
      toast.success("Credenciales globales guardadas");
      setShowUbConfig(false);
      setHasGlobalConfig(true);
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Reboot ───────────────────────────────────
  const handleReboot = async (ant: UnifiedAntenna) => {
    if (!confirm(`¿Reiniciar ${ant.name}?`)) return;
    try {
      if (ant.brand === "mikrotik") await apiPost(`/antennas/devices/${ant.id}/reboot`, {});
      else if (ant.ubiquiti_id) await apiPost(`/ubiquiti/devices/${ant.ubiquiti_id}/reboot`, {});
      toast.success(`${ant.name} reiniciándose...`);
    } catch (e: any) { toast.error(e.message); }
  };

  // ─── Detail ───────────────────────────────────
  const handleViewDetail = async (ant: UnifiedAntenna) => {
    setDetailAntenna(ant);
    setDetailLoading(true);
    setDetailData(null);
    try {
      if (ant.brand === "mikrotik") {
        const data = await apiGet(`/antennas/devices/${ant.id}/wireless`);
        setDetailData({ ...data, brand: "mikrotik" });
      } else if (ant.ubiquiti_id) {
        const data = await apiGet(`/ubiquiti/devices/${ant.ubiquiti_id}/status`);
        setDetailData({ ...data, brand: "ubiquiti" });
      }
    } catch (e: any) { toast.error(e.message); }
    setDetailLoading(false);
  };

  const openEditUb = (ant: UnifiedAntenna) => {
    setEditUb(ant);
    setUbForm({ name: ant.name, ip_address: ant.host, username: "", password: "", model: ant.model || "", mac_address: "", notes: "" });
  };

  const filtered = brandFilter === "all" ? antennas : antennas.filter((a) => a.brand === brandFilter);
  const mkCount = antennas.filter((a) => a.brand === "mikrotik").length;
  const ubCount = antennas.filter((a) => a.brand === "ubiquiti").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-5 w-5" /> Monitoreo de Antenas
          </h3>
          <p className="text-sm text-muted-foreground">
            {antennas.length} antena{antennas.length !== 1 ? "s" : ""}
            {mkCount > 0 && ` · ${mkCount} MikroTik`}
            {ubCount > 0 && ` · ${ubCount} Ubiquiti`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[140px] h-8">
              <Filter className="h-3 w-3 mr-1" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="mikrotik">🔵 MikroTik</SelectItem>
              <SelectItem value="ubiquiti">🟢 Ubiquiti</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => setShowUbConfig(true)}>
            <Settings2 className="h-4 w-4 mr-1" /> Cred. Globales
          </Button>

          <Button variant="outline" size="sm" onClick={() => void refreshAllStatuses()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Consultando..." : "Señales"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Agregar <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => { setMkForm(emptyMkForm); setShowAddMk(true); }}>
                🔵 Antena MikroTik
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setUbForm(emptyUbForm); setShowAddUb(true); }}>
                🟢 Antena Ubiquiti
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Cards Grid */}
      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando antenas...</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay antenas registradas</p>
            <p className="text-sm text-muted-foreground">Usa el botón "Agregar" para registrar tus antenas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((ant) => {
            const bc = brandConfig[ant.brand];
            return (
              <Card key={ant.id} className="relative">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-primary" /> {ant.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{ant.host}</p>
                      {ant.model && <p className="text-xs text-muted-foreground">{ant.model}</p>}
                      {ant.board && <p className="text-xs text-muted-foreground">{ant.board}</p>}
                      {ant.client_name && <p className="text-xs text-muted-foreground">👤 {ant.client_name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={`${bc.color} text-xs text-white`}>{bc.icon} {bc.label}</Badge>
                      {ant.status === "online" && <Badge className="bg-green-600 text-xs">Online</Badge>}
                      {ant.status === "offline" && <Badge variant="destructive" className="text-xs">Offline</Badge>}
                      {ant.status === "no_credentials" && <Badge variant="outline" className="text-xs">Sin cred.</Badge>}
                      {signalBadge(ant.signal)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Señal</p>
                      <p className={`text-sm font-bold ${signalColor(ant.signal)}`}>{ant.signal != null ? `${ant.signal} dBm` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Ruido</p>
                      <p className="text-sm font-medium">{ant.noise != null ? `${ant.noise} dBm` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CCQ</p>
                      <p className="text-sm font-medium">{ant.ccq != null ? `${ant.ccq}%` : "—"}</p>
                    </div>
                  </div>

                  <div className="flex justify-center gap-4 text-xs text-muted-foreground">
                    {ant.connected_clients != null && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {ant.connected_clients}</span>}
                    {ant.cpu != null && <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {ant.cpu}%</span>}
                    {ant.uptime && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {ant.uptime}</span>}
                  </div>

                  <div className="flex gap-1 justify-center pt-1">
                    <Button variant="ghost" size="sm" onClick={() => handleViewDetail(ant)} title="Ver detalle"><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleReboot(ant)} title="Reiniciar"><RotateCcw className="h-4 w-4" /></Button>
                    {ant.brand === "ubiquiti" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEditUb(ant)} title="Editar"><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteUb(ant)} title="Eliminar" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </div>

                  {ant.brand === "ubiquiti" && !ant.status && !hasGlobalConfig && (
                    <div className="flex items-center gap-1 text-xs text-orange-500 justify-center">
                      <AlertTriangle className="h-3 w-3" /> Configura credenciales globales
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── Add MikroTik Dialog ─── */}
      <Dialog open={showAddMk} onOpenChange={setShowAddMk}>
        <DialogContent>
          <DialogHeader><DialogTitle>🔵 Agregar Antena MikroTik</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label><Input value={mkForm.name} onChange={(e) => setMkForm({ ...mkForm, name: e.target.value })} placeholder="Torre Norte - RB LDF" /></div>
              <div><Label>Host/IP *</Label><Input value={mkForm.host} onChange={(e) => setMkForm({ ...mkForm, host: e.target.value })} placeholder="10.13.13.5" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Usuario *</Label><Input value={mkForm.username} onChange={(e) => setMkForm({ ...mkForm, username: e.target.value })} placeholder="admin" /></div>
              <div><Label>Contraseña *</Label><Input type="password" value={mkForm.password} onChange={(e) => setMkForm({ ...mkForm, password: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Puerto API</Label>
                <Input type="number" value={mkForm.port} onChange={(e) => setMkForm({ ...mkForm, port: parseInt(e.target.value) || 443 })} />
                <p className="text-xs text-muted-foreground mt-1">443 (HTTPS), 80 (HTTP), 8728 (API)</p>
              </div>
              <div>
                <Label>Versión</Label>
                <Select value={mkForm.version} onValueChange={(v) => setMkForm({ ...mkForm, version: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v7">v7 (REST API)</SelectItem>
                    <SelectItem value="v6">v6 (API Legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleAddMk}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Add Ubiquiti Dialog ─── */}
      <Dialog open={showAddUb} onOpenChange={setShowAddUb}>
        <DialogContent>
          <DialogHeader><DialogTitle>🟢 Agregar Antena Ubiquiti</DialogTitle></DialogHeader>
          <UbiquitiForm form={ubForm} setForm={setUbForm} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleAddUb}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Ubiquiti Dialog ─── */}
      <Dialog open={!!editUb} onOpenChange={(o) => !o && setEditUb(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Ubiquiti</DialogTitle></DialogHeader>
          <UbiquitiForm form={ubForm} setForm={setUbForm} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleEditUb}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Global Config Dialog ─── */}
      <Dialog open={showUbConfig} onOpenChange={setShowUbConfig}>
        <DialogContent>
          <DialogHeader><DialogTitle>Credenciales Globales Ubiquiti</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se usarán para todos los equipos Ubiquiti sin credenciales propias.</p>
          <div className="space-y-3">
            <div><Label>Usuario</Label><Input value={configForm.default_username} onChange={(e) => setConfigForm({ ...configForm, default_username: e.target.value })} placeholder="ubnt" /></div>
            <div><Label>Contraseña</Label><Input type="password" value={configForm.default_password} onChange={(e) => setConfigForm({ ...configForm, default_password: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleSaveConfig}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Detail Dialog ─── */}
      <Dialog open={!!detailAntenna} onOpenChange={(o) => !o && setDetailAntenna(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" /> {detailAntenna?.name}
              {detailAntenna && <Badge className={`${brandConfig[detailAntenna.brand].color} text-white ml-2`}>{brandConfig[detailAntenna.brand].label}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground"><RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />Conectando...</div>
          ) : detailData?.brand === "mikrotik" ? (
            <MikrotikDetail data={detailData} />
          ) : detailData?.brand === "ubiquiti" ? (
            <UbiquitiDetail data={detailData} />
          ) : (
            <p className="py-8 text-center text-muted-foreground">No se pudo obtener información</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Ubiquiti Form ──────────────────────────────
function UbiquitiForm({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Torre Norte - LiteBeam" /></div>
        <div><Label>IP *</Label><Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.20" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Modelo</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="LiteBeam 5AC Gen2" /></div>
        <div><Label>MAC</Label><Input value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Usuario (vacío = global)</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ubnt" /></div>
        <div><Label>Contraseña (vacío = global)</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      </div>
      <div><Label>Notas</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Enlace principal" /></div>
    </div>
  );
}

// ─── MikroTik Detail ────────────────────────────
function MikrotikDetail({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Sistema</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            <Info label="Nombre" value={data.device_name} />
            <Info label="Board" value={data.board_name} />
            <Info label="RouterOS" value={data.version} />
            <Info label="Uptime" value={data.uptime} />
            <Info label="CPU" value={`${data.cpu_load}%`} />
            <Info label="RAM" value={`${fmtB(data.free_memory)} / ${fmtB(data.total_memory)}`} />
          </div>
        </CardContent>
      </Card>

      {data.wireless_interfaces?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wifi className="h-4 w-4" /> Interfaces Wireless</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.wireless_interfaces.map((w: any, i: number) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm p-2 rounded bg-muted/30">
                <Info label="Interfaz" value={w.name} />
                <Info label="SSID" value={w.ssid} />
                <Info label="Modo" value={w.mode} />
                <Info label="Frecuencia" value={w.frequency ? `${w.frequency} MHz` : "—"} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Clientes ({data.clients?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.clients?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin clientes wireless</p>
          ) : (
            <div className="space-y-2">
              {data.clients.map((c: any, i: number) => (
                <div key={i} className="p-3 rounded-lg border bg-card space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium flex items-center gap-2"><Wifi className="h-4 w-4 text-primary" />{c.radio_name || c.mac_address}</span>
                    {signalBadge(c.signal_strength)}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <span><span className="text-muted-foreground">Señal:</span> <span className={`font-medium ${signalColor(c.signal_strength)}`}>{c.signal_strength} dBm</span></span>
                    <span><span className="text-muted-foreground">Ruido:</span> <span className="font-medium">{c.noise_floor} dBm</span></span>
                    <span><span className="text-muted-foreground">CCQ:</span> <span className="font-medium">{c.tx_ccq}%</span></span>
                    <span><span className="text-muted-foreground">TX:</span> <span className="font-medium">{c.tx_rate || "—"}</span></span>
                    <span><span className="text-muted-foreground">RX:</span> <span className="font-medium">{c.rx_rate || "—"}</span></span>
                    <span><span className="text-muted-foreground">IP:</span> <span className="font-medium">{c.last_ip || "—"}</span></span>
                    <span><span className="text-muted-foreground">Uptime:</span> <span className="font-medium">{c.uptime || "—"}</span></span>
                    {c.distance > 0 && <span><span className="text-muted-foreground">Dist:</span> <span className="font-medium">{c.distance}m</span></span>}
                  </div>
                  <p className="text-xs text-muted-foreground">MAC: {c.mac_address}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Ubiquiti Detail ────────────────────────────
function UbiquitiDetail({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <InfoCard label="Dispositivo" value={data.device_name} />
        <InfoCard label="Firmware" value={data.firmware} />
        <InfoCard label="Señal" value={data.signal != null ? `${data.signal} dBm` : "N/A"} color={signalColor(data.signal)} />
        <InfoCard label="Ruido" value={data.noise != null ? `${data.noise} dBm` : "N/A"} />
        <InfoCard label="CCQ" value={data.ccq != null ? `${Math.round(data.ccq / 10)}%` : "N/A"} />
        <InfoCard label="Frecuencia" value={data.frequency ? `${data.frequency} MHz` : "N/A"} />
        <InfoCard label="TX Rate" value={data.tx_rate ? `${data.tx_rate} Mbps` : "N/A"} />
        <InfoCard label="RX Rate" value={data.rx_rate ? `${data.rx_rate} Mbps` : "N/A"} />
        <InfoCard label="CPU" value={data.cpu != null ? `${data.cpu}%` : "N/A"} />
        {data.temperature != null && <InfoCard label="Temp" value={`${data.temperature}°C`} />}
        {data.tx_power != null && <InfoCard label="TX Power" value={`${data.tx_power} dBm`} />}
      </div>
      <p className="text-xs text-muted-foreground text-center">Uptime: {data.uptime}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="text-sm"><span className="text-muted-foreground">{label}: </span><span className="font-medium">{value || "—"}</span></div>;
}

function InfoCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-2 rounded bg-muted/30">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${color || ""}`}>{value}</p>
    </div>
  );
}

function fmtB(b: number): string {
  if (!b) return "0";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}
