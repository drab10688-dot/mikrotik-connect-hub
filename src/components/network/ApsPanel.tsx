import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { devicesApi, netAccessApi } from "@/lib/api-client";
import { useMyPermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
import {
  Search, RefreshCw, Save, Loader2, SignalHigh, KeyRound, Plus, Trash2, AlertTriangle, Pencil,
} from "lucide-react";
import { ApSignalDialog, type ApTargetInfo } from "@/components/network/ApSignalDialog";

const AP_QUALITY: Record<string, { label: string; className: string }> = {
  excelente: { label: "Excelente", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  buena: { label: "Buena", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  regular: { label: "Regular", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  mala: { label: "Mala", className: "bg-destructive/15 text-destructive border-destructive/30" },
  desconocida: { label: "Sin datos", className: "bg-muted text-muted-foreground" },
};

/**
 * APs de torre de una sede: detección automática desde la MikroTik, señal de
 * sus clientes wireless, guardar en el mapa, fijar IP y credenciales de APs.
 * Vive en "Mapa de red" (antes era la pestaña "APs / Señal" de Conexión MikroTik).
 * Ver = "Antenas y APs" (red); cambios = "red" con editar.
 */
export function ApsPanel({ deviceId }: { deviceId: string }) {
  const qc = useQueryClient();
  const perms = useMyPermissions();
  const canRed = perms.can("red");
  const canEditRed = perms.can("red", true);
  const browserOpen = false;
  const [signalAp, setSignalAp] = useState<ApTargetInfo | null>(null);

  const { data: devices = [] } = useQuery({
    queryKey: ["net-devices"],
    queryFn: () => devicesApi.list(),
  });


  // ─── Credenciales de APs + señal consolidada ───
  const [showApForm, setShowApForm] = useState(false);
  type ApForm = { id?: string; ip: string; name: string; brand: string; username: string; password: string; port: string; tower: string; sector: string; role: string; mikrotik_id: string };
  const EMPTY_AP_FORM: ApForm = { ip: "", name: "", brand: "mikrotik", username: "admin", password: "", port: "", tower: "", sector: "", role: "sector", mikrotik_id: "" };
  const [apForm, setApForm] = useState<ApForm>(EMPTY_AP_FORM);

  // APs guardados de ESTA sede (cada AP pertenece a un MikroTik)
  const { data: apCreds, isLoading: apCredsLoading } = useQuery({
    queryKey: ["ap-credentials", deviceId],
    queryFn: () => netAccessApi.listApCredentials(deviceId),
    enabled: !!deviceId && canRed,
  });

  const apCredList = (apCreds || []) as any[];

  // Lectura automática: detecta cualquier AP desde la MikroTik y lee su señal
  // probando credenciales típicas por marca. No requiere registrar nada.
  const { data: apsAuto, isFetching: apsAutoFetching, error: apsAutoError, refetch: refetchApsAuto } = useQuery({
    queryKey: ["aps-auto", deviceId],
    queryFn: () => netAccessApi.apsAuto(deviceId),
    enabled: !!deviceId && !browserOpen && canRed,
    refetchInterval: browserOpen ? false : 60_000,
    refetchOnWindowFocus: false,
  });
  const autoAps: any[] = (apsAuto as any)?.aps ?? [];


  const saveAp = useMutation({
    mutationFn: () => {
      const { id, ...payload } = apForm;
      return netAccessApi.saveApCredentials({
        ...payload,
        name: payload.name || null,
        port: payload.port ? Number(payload.port) : null,
        mikrotik_id: payload.mikrotik_id || deviceId,
      });
    },
    onSuccess: () => {
      toast.success("AP guardado");
      qc.invalidateQueries({ queryKey: ["ap-credentials"] });
      qc.invalidateQueries({ queryKey: ["topology", deviceId] });
      setShowApForm(false);
      setApForm(EMPTY_AP_FORM);
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar"),
  });

  // Guardar en el mapa los APs detectados (todos o uno)
  const saveDetected = useMutation({
    mutationFn: (ips?: string[]) => netAccessApi.saveDetectedAps(deviceId, ips),
    onSuccess: (d: any) => {
      toast.success(d?.saved ? `${d.saved} AP guardados en el mapa` : "No había APs nuevos para guardar");
      qc.invalidateQueries({ queryKey: ["ap-credentials"] });
      qc.invalidateQueries({ queryKey: ["aps-auto", deviceId] });
      qc.invalidateQueries({ queryKey: ["topology", deviceId] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar"),
  });

  const fixApIp = useMutation({
    mutationFn: (ip: string) => netAccessApi.fixApIp(deviceId, ip),
    onSuccess: (d: any) => {
      toast.success(d?.message || "IP fijada");
      qc.invalidateQueries({ queryKey: ["aps-auto", deviceId] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo fijar la IP"),
  });
  const unsavedDetected = autoAps.filter((a: any) => a.ok && !a.saved).length;

  const deleteAp = useMutation({
    mutationFn: (id: string) => netAccessApi.deleteApCredentials(id),
    onSuccess: () => {
      toast.success("AP eliminado");
      qc.invalidateQueries({ queryKey: ["ap-credentials"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo eliminar"),
  });

  // ─── Antena ↔ cliente PPPoE ───
  const [apClientFilter, setApClientFilter] = useState("");
  const [apWeakOnly, setApWeakOnly] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ mac: string; antenna: string; ap: string; current?: string } | null>(null);
  const [linkSearch, setLinkSearch] = useState("");

  const isWeakSignal = (cl: any) => cl.quality === "mala" || (cl.signal != null && cl.signal < -75);

  const apClientVisible = (ap: any, cl: any) => {
    if (apWeakOnly && !isWeakSignal(cl)) return false;
    const term = apClientFilter.trim().toLowerCase();
    if (!term) return true;
    return [ap.ip, ap.name, cl.name, cl.mac, cl.pppoe?.user, cl.pppoe?.comment]
      .filter(Boolean)
      .some((v: string) => String(v).toLowerCase().includes(term));
  };

  const linkMut = useMutation({
    mutationFn: ({ mac, user }: { mac: string; user: string }) => netAccessApi.saveApLink(deviceId, mac, user),
    onSuccess: () => {
      toast.success("Cliente asignado a la antena");
      setLinkTarget(null);
      qc.invalidateQueries({ queryKey: ["aps-auto", deviceId] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo asignar"),
  });

  const unlinkMut = useMutation({
    mutationFn: (mac: string) => netAccessApi.deleteApLink(deviceId, mac),
    onSuccess: () => {
      toast.success("Asignación eliminada");
      qc.invalidateQueries({ queryKey: ["aps-auto", deviceId] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo quitar"),
  });

  const MATCH_LABEL: Record<string, string> = {
    manual: "Asignado",
    mac: "Por MAC",
    "mac-cercana": "MAC aprox.",
    ip: "Por IP",
    sugerido: "Sugerido",
  };

  const renderPppoeLink = (ap: any, cl: any) => {
    const p = cl.pppoe;
    const openAssign = () => {
      setLinkSearch("");
      setLinkTarget({ mac: cl.mac, antenna: cl.name || cl.mac, ap: ap.name || ap.ip, current: p?.user });
    };
    if (!cl.mac) return <span className="text-muted-foreground">—</span>;
    if (!p) {
      if (!canEditRed) return <span className="text-muted-foreground">—</span>;
      return (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openAssign}>
          <Plus className="w-3 h-3 mr-1" /> Asignar
        </Button>
      );
    }
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${p.online ? "bg-emerald-500" : "bg-muted-foreground/40"}`} title={p.online ? "PPPoE conectado" : "PPPoE desconectado"} />
            <span className="font-medium">{p.user}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${p.match === "sugerido" ? "border-amber-500/40 text-amber-500" : ""}`}>
              {MATCH_LABEL[p.match] || p.match}{p.match === "sugerido" && p.delta_s != null ? ` · ${p.delta_s}s` : ""}
            </Badge>
          </div>
          {p.comment && <p className="text-xs text-muted-foreground truncate max-w-[220px]">{p.comment}</p>}
        </div>
        {canEditRed && <div className="flex gap-0.5">
          {p.match === "sugerido" && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" title="Confirmar sugerencia" onClick={() => linkMut.mutate({ mac: cl.mac, user: p.user })}>
              ✓
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Cambiar cliente" onClick={openAssign}>
            <Pencil className="w-3 h-3" />
          </Button>
          {p.match === "manual" && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5" title="Quitar asignación" onClick={() => unlinkMut.mutate(cl.mac)}>
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          )}
        </div>}
      </div>
    );
  };

  // Clientes PPPoE de la sede: solo para el diálogo "Asignar cliente"
  const { data: pppoeData } = useQuery({
    queryKey: ["net-pppoe", deviceId],
    queryFn: () => netAccessApi.pppoe(deviceId),
    enabled: !!deviceId && !!linkTarget,
    refetchOnWindowFocus: false,
  });
  const secrets: any[] = (pppoeData as any)?.secrets ?? [];

  if (!deviceId) return <p className="text-sm text-muted-foreground">Selecciona un router en Conexión MikroTik.</p>;

  return (
    <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><SignalHigh className="w-4 h-4" /> APs / Antenas detectados</CardTitle>
                  <CardDescription>
                    El panel descubre solo las antenas desde la MikroTik (vecinos y ARP) y lee la señal de cualquier marca sin abrir navegador ni registrar nada. Se actualiza cada 60 s.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {canEditRed && unsavedDetected > 0 && (
                    <Button size="sm" onClick={() => saveDetected.mutate(undefined)} disabled={saveDetected.isPending}>
                      {saveDetected.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Guardar {unsavedDetected} en el mapa
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => refetchApsAuto()} disabled={apsAutoFetching}>
                    {apsAutoFetching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                    Actualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {apsAutoError ? (
                  <p className="text-sm text-destructive">{(apsAutoError as any).message}</p>
                ) : apsAutoFetching && !autoAps.length ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando y leyendo antenas…</p>
                ) : !autoAps.length ? (
                  <p className="text-sm text-muted-foreground">No se detectaron antenas desde este MikroTik todavía.</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Detectados</p>
                        <p className="text-xl font-semibold">{(apsAuto as any)?.scanned ?? autoAps.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Leídos correctamente</p>
                        <p className="text-xl font-semibold text-emerald-500">{(apsAuto as any)?.online ?? 0}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Clientes wireless</p>
                        <p className="text-xl font-semibold">{(apsAuto as any)?.total_clients ?? 0}</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-muted-foreground">
                          <tr className="border-b">
                            <th className="py-2 pr-4">IP</th>
                            <th className="py-2 pr-4">Nombre</th>
                            <th className="py-2 pr-4">Marca</th>
                            <th className="py-2 pr-4">MAC</th>
                            <th className="py-2 pr-4">Clientes</th>
                            <th className="py-2 pr-4">Estado</th>
                            <th className="py-2">Mapa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoAps.map((ap: any) => (
                            <tr key={ap.ip} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-mono text-xs">
                                {ap.ip}
                                {canEditRed && ap.dhcp === "dinamica" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="ml-1 h-6 px-1.5 text-[11px] text-amber-500"
                                    title="Recibe IP por DHCP y puede cambiar: fíjala en el MikroTik"
                                    onClick={() => fixApIp.mutate(ap.ip)}
                                    disabled={fixApIp.isPending}
                                  >
                                    Fijar IP
                                  </Button>
                                )}
                              </td>
                              <td className="py-2 pr-4">
                                {ap.name || "—"}
                                {(ap.tower || ap.sector) && (
                                  <span className="block text-[11px] text-muted-foreground">
                                    {[ap.tower, ap.role === "ptp" ? "Enlace PtP" : ap.sector].filter(Boolean).join(" · ")}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-4 capitalize">{ap.brand}</td>
                              <td className="py-2 pr-4 font-mono text-[11px]">{ap.mac || "—"}</td>
                              <td className="py-2 pr-4"><Badge variant={ap.clients?.length ? "default" : "secondary"}>{ap.clients?.length ?? 0}</Badge></td>
                              <td className="py-2 pr-4">
                                {ap.ok ? (
                                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Leído</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{ap.error || "Sin lectura"}</span>
                                )}
                              </td>
                              <td className="py-2">
                                {ap.saved ? (
                                  <Badge variant="secondary">En el mapa</Badge>
                                ) : !canEditRed ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : ap.ok ? (
                                  <Button size="sm" variant="outline" className="h-7" onClick={() => saveDetected.mutate([ap.ip])} disabled={saveDetected.isPending}>
                                    <Save className="w-3.5 h-3.5 mr-1" /> Guardar
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Agrégalo abajo con su clave</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Todos los clientes wireless consolidados */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><SignalHigh className="w-4 h-4" /> Clientes wireless de todos los APs</CardTitle>
                  <CardDescription>
                    Cada antena con su cliente PPPoE. Si la antena está en puente, asígnalo una vez (o confirma la sugerencia por hora de conexión) y queda guardado.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    className="h-8 w-48"
                    placeholder="Buscar cliente, MAC, AP…"
                    value={apClientFilter}
                    onChange={(e) => setApClientFilter(e.target.value)}
                  />
                  <Button size="sm" variant={apWeakOnly ? "default" : "outline"} onClick={() => setApWeakOnly((v) => !v)}>
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Señal mala
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-4">AP</th>
                        <th className="py-2 pr-4">Cliente PPPoE</th>
                        <th className="py-2 pr-4">Antena</th>
                        <th className="py-2 pr-4">MAC</th>
                        <th className="py-2 pr-4">Señal</th>
                        <th className="py-2 pr-4">SNR</th>
                        <th className="py-2 pr-4">CCQ</th>
                        <th className="py-2 pr-4">TX / RX</th>
                        <th className="py-2 pr-4">Uptime</th>
                        <th className="py-2">Calidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoAps.flatMap((ap: any) =>
                        (ap.clients ?? []).filter((cl: any) => apClientVisible(ap, cl)).map((cl: any, i: number) => {
                          const q = AP_QUALITY[cl.quality] || AP_QUALITY.desconocida;
                          const weak = isWeakSignal(cl);
                          return (
                            <tr key={`${ap.ip}-${cl.mac || i}`} className={`border-b last:border-0 ${weak ? "bg-destructive/5" : ""}`}>
                              <td className="py-2 pr-4 font-mono text-xs">{ap.name && ap.name !== ap.ip ? <span title={ap.ip}>{ap.name}</span> : ap.ip}</td>
                              <td className="py-2 pr-4">{renderPppoeLink(ap, cl)}</td>
                              <td className="py-2 pr-4 text-xs">{cl.name || "—"}</td>
                              <td className="py-2 pr-4 font-mono text-xs">{cl.mac || "—"}</td>
                              <td className="py-2 pr-4 font-mono">{cl.signal != null ? `${cl.signal} dBm` : "—"}</td>
                              <td className="py-2 pr-4">{cl.snr != null ? `${cl.snr} dB` : "—"}</td>
                              <td className="py-2 pr-4">{cl.ccq != null ? `${cl.ccq}%` : "—"}</td>
                              <td className="py-2 pr-4 text-xs">{[cl.tx_rate, cl.rx_rate].filter(Boolean).join(" / ") || "—"}</td>
                              <td className="py-2 pr-4 text-xs">{cl.uptime || "—"}</td>
                              <td className="py-2"><Badge variant="outline" className={q.className}>{q.label}</Badge></td>
                            </tr>
                          );
                        })
                      )}
                      {!autoAps.some((ap: any) => (ap.clients ?? []).length) && !apsAutoFetching && (
                        <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">Ningún AP reporta clientes wireless todavía.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Credenciales opcionales (solo para APs con clave propia) */}
            {canEditRed && <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2"><KeyRound className="w-4 h-4" /> APs y enlaces de esta sede (mapa de red)</CardTitle>
                  <CardDescription>
                    Los APs guardados forman el Mapa de red: torre → enlace PtP / sectores → clientes. Se reconocen por su MAC,
                    así que si reciben IP por DHCP el panel los sigue aunque la IP cambie. Agrega a mano solo los que no se detecten.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setApForm(EMPTY_AP_FORM); setShowApForm((v) => !v); }}>
                  <Plus className="w-4 h-4 mr-1" /> Agregar AP
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {showApForm && (
                  <div className="grid gap-3 md:grid-cols-6 rounded-lg border p-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">IP del AP</Label>
                      <Input placeholder="10.82.3.10" value={apForm.ip} onChange={(e) => setApForm({ ...apForm, ip: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nombre</Label>
                      <Input placeholder="Torre Sur" value={apForm.name} onChange={(e) => setApForm({ ...apForm, name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Marca</Label>
                      <Select value={apForm.brand} onValueChange={(v) => setApForm({ ...apForm, brand: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mikrotik">MikroTik</SelectItem>
                          <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                          <SelectItem value="mimosa">Mimosa</SelectItem>
                          <SelectItem value="cambium">Cambium</SelectItem>
                          <SelectItem value="tplink">TP-Link</SelectItem>
                          <SelectItem value="otro">Otra</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Usuario</Label>
                      <Input value={apForm.username} onChange={(e) => setApForm({ ...apForm, username: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Contraseña</Label>
                      <Input type="password" placeholder="••••••" value={apForm.password} onChange={(e) => setApForm({ ...apForm, password: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Puerto</Label>
                      <Input type="number" placeholder="auto" value={apForm.port} onChange={(e) => setApForm({ ...apForm, port: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Sede (MikroTik)</Label>
                      <Select value={apForm.mikrotik_id || deviceId} onValueChange={(v) => setApForm({ ...apForm, mikrotik_id: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(devices as any[]).map((d: any) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Torre / nodo</Label>
                      <Input placeholder="Torre Norte" value={apForm.tower} onChange={(e) => setApForm({ ...apForm, tower: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo</Label>
                      <Select value={apForm.role} onValueChange={(v) => setApForm({ ...apForm, role: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sector">Sector / AP</SelectItem>
                          <SelectItem value="ptp">Enlace PtP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Sector</Label>
                      <Input
                        placeholder={apForm.role === "ptp" ? "—" : "Sector 1 (90°)"}
                        disabled={apForm.role === "ptp"}
                        value={apForm.sector}
                        onChange={(e) => setApForm({ ...apForm, sector: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button size="sm" onClick={() => saveAp.mutate()} disabled={saveAp.isPending}>
                        <Save className="w-3.5 h-3.5 mr-1" /> Guardar
                      </Button>
                    </div>
                  </div>
                )}

                {apCredsLoading ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
                ) : apCredList.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-4">Torre</th>
                          <th className="py-2 pr-4">Tipo / sector</th>
                          <th className="py-2 pr-4">IP</th>
                          <th className="py-2 pr-4">Nombre</th>
                          <th className="py-2 pr-4">Marca</th>
                          <th className="py-2 pr-4">MAC</th>
                          <th className="py-2 pr-4">Usuario</th>
                          <th className="py-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apCredList.map((c: any) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                              {c.tower || "—"}
                              {!c.mikrotik_id && <Badge variant="outline" className="ml-1 text-[10px] border-amber-500/40 text-amber-500" title="Edítalo y elige su MikroTik">Sin sede</Badge>}
                            </td>
                            <td className="py-2 pr-4">
                              {c.role === "ptp" ? <Badge variant="outline">Enlace PtP</Badge> : c.sector || "Sin sector"}
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">{c.ip}</td>
                            <td className="py-2 pr-4">{c.name || "—"}</td>
                            <td className="py-2 pr-4 capitalize">{c.brand}</td>
                            <td className="py-2 pr-4 font-mono text-[11px]">{c.mac || "—"}</td>
                            <td className="py-2 pr-4">{c.username || "—"}</td>
                            <td className="py-2">
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" title="Editar" onClick={() => { setApForm({ id: c.id, ip: c.ip, name: c.name || "", brand: c.brand, username: c.username || "", password: "", port: c.port ? String(c.port) : "", tower: c.tower || "", sector: c.sector || "", role: c.role || "sector", mikrotik_id: c.mikrotik_id || deviceId }); setShowApForm(true); }}>
                                  <KeyRound className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteAp.mutate(c.id)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Todavía no hay APs guardados en esta sede. Usa "Guardar en el mapa" arriba o agrega uno a mano.</p>
                )}
              </CardContent>
            </Card>}

        <ApSignalDialog
          mikrotikId={deviceId}
          target={signalAp}
          onOpenChange={(open) => !open && setSignalAp(null)}
        />

        {/* Asignar cliente PPPoE a una antena */}
        <Dialog open={!!linkTarget} onOpenChange={(open) => !open && setLinkTarget(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Asignar cliente PPPoE</DialogTitle>
              <DialogDescription>
                Antena <span className="font-medium">{linkTarget?.antenna}</span> ({linkTarget?.mac}) en {linkTarget?.ap}. Queda guardado para esta MAC.
              </DialogDescription>
            </DialogHeader>
            <Input autoFocus placeholder="Buscar por usuario o comentario…" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} />
            <div className="max-h-80 overflow-y-auto divide-y rounded-md border">
              {(secrets || [])
                .filter((s: any) => {
                  const t = linkSearch.trim().toLowerCase();
                  return !t || `${s.name} ${s.comment || ""}`.toLowerCase().includes(t);
                })
                .slice(0, 100)
                .map((s: any) => (
                  <button
                    key={`${s.source}-${s.id}-${s.name}`}
                    type="button"
                    disabled={linkMut.isPending}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/60 flex items-center gap-2 ${linkTarget?.current === s.name ? "bg-muted" : ""}`}
                    onClick={() => linkTarget && linkMut.mutate({ mac: linkTarget.mac, user: s.name })}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${s.online ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <span className="font-medium">{s.name}</span>
                    {s.comment && <span className="text-xs text-muted-foreground truncate">{s.comment}</span>}
                  </button>
                ))}
              {!(secrets || []).length && (
                <p className="px-3 py-4 text-sm text-muted-foreground">Cargando clientes PPPoE…</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
    </div>
  );
}
