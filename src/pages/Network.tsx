import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { devicesApi, netAccessApi, pppoeApi, getApiBaseUrl, withAuthToken, remoteDesktopUrl, browserApi } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Router as RouterIcon, Users, Wifi, Search, RefreshCw, ExternalLink,
  Monitor, Save, Loader2, Antenna, SignalHigh, KeyRound, Plus, Trash2, Cable,
  AlertTriangle, PlugZap, Activity, Globe, ArrowUp, ArrowDown, ArrowUpDown, Pencil, MonitorCog,
} from "lucide-react";
import { winboxApi, openWinbox, openWinboxTo, winboxReadyText } from "@/lib/winbox-api";
import { CpePanel } from "@/components/network/CpePanel";
import { ProxyBrowserDialog, type ProxyBrowserTarget } from "@/components/network/ProxyBrowserDialog";
import { usePagedSearch } from "@/hooks/use-paged-search";
import { SearchBox, Pager } from "@/components/common/SearchPager";
import { useMyPermissions } from "@/hooks/usePermissions";

interface WebPortCfg { port: number; protocol: "http" | "https" }

const BRAND_LABEL: Record<string, string> = {
  mikrotik: "MikroTik (WebFig)",
  ubiquiti: "Ubiquiti (airOS/UniFi)",
  mimosa: "Mimosa",
  cambium: "Cambium",
  tplink: "TP-Link",
  huawei: "Huawei",
  vsol: "V-SOL",
  otro: "Otras marcas",
};

const proxyUrl = (path: string) => {
  const base = getApiBaseUrl().replace(/\/api$/, "");
  return withAuthToken(`${base}${path}`);
};

export default function Network() {
  const qc = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("mikrotik_device_id") || "");
  const [search, setSearch] = useState("");
  const [browserTarget, setBrowserTarget] = useState<ProxyBrowserTarget | null>(null);
  const browserOpen = Boolean(browserTarget);
  // Permisos del técnico (admin y super admin: todo). Las sesiones PPPoE,
  // alertas, desconexiones y cableado son del router ("Conexión MikroTik") y
  // se leen por netaccess, que pide "Antenas y APs"; APs y antenas cliente solo
  // "Antenas y APs". Editar en antenas/APs = "Antenas y APs" con editar.
  const perms = useMyPermissions();
  const canDesktop = perms.can("escritorio");
  const canWinbox = perms.can("winbox");

  /** Abre un cliente (su antena) en el WinBox remoto con la IP lista para Ctrl+V. */
  const openWinboxClient = async (ip: string) => {
    try {
      toast.success(winboxReadyText(await openWinboxTo(deviceId, ip)));
    } catch (e: any) {
      toast.error(e?.message || "No se pudo abrir el equipo en WinBox");
    }
  };
  const [openingWinbox, setOpeningWinbox] = useState(false);
  // IP de túnel de cada router (la que se escribe en WinBox)
  const { data: winboxStatus } = useQuery({
    queryKey: ["winbox-status"],
    queryFn: () => winboxApi.status(),
    enabled: canWinbox,
    staleTime: 60_000,
  });
  const winboxRouters = winboxStatus?.routers || [];
  const canRed = perms.can("red");
  const canEditRed = perms.can("red", true);
  const canSessions = perms.can("mikrotik") && canRed;
  const isFull = perms.fullAccess;

  const { data: devices = [] } = useQuery({
    queryKey: ["net-devices"],
    queryFn: () => devicesApi.list(),
  });

  useEffect(() => {
    if (!deviceId && devices.length) setDeviceId(devices[0].id);
  }, [devices, deviceId]);

  const { data: pppoe, isLoading: loadingPppoe, refetch: refetchPppoe, error: pppoeError } = useQuery({
    queryKey: ["net-pppoe", deviceId],
    queryFn: () => netAccessApi.pppoe(deviceId),
    enabled: !!deviceId && !browserOpen && canSessions,
    refetchInterval: browserOpen ? false : 30_000,
    refetchOnWindowFocus: false,
    // Mantiene la lista anterior si un refresco falla o llega vacío (VPN inestable)
    placeholderData: (prev: any) => prev,
    retry: 1,
  });


  const { data: ports } = useQuery({
    queryKey: ["net-web-ports"],
    queryFn: () => netAccessApi.getWebPorts(),
  });

  const { data: ethernet, isLoading: loadingEth, isFetching: fetchingEth, refetch: refetchEth, error: ethError } = useQuery({
    queryKey: ["net-ethernet", deviceId],
    queryFn: () => netAccessApi.ethernet(deviceId),
    enabled: !!deviceId && !browserOpen && canSessions,
    refetchInterval: browserOpen ? false : 20_000,
    refetchOnWindowFocus: false,
  });

  const [eventDays, setEventDays] = useState("7");
  const { data: pppoeEvents, isLoading: loadingEvents, isFetching: fetchingEvents, refetch: refetchEvents, error: eventsError } = useQuery({
    queryKey: ["net-pppoe-events", deviceId, eventDays],
    queryFn: () => netAccessApi.pppoeEvents(deviceId, Number(eventDays)),
    enabled: !!deviceId && !browserOpen && canSessions,
    refetchInterval: browserOpen ? false : 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: lanAlerts, isFetching: fetchingAlerts, refetch: refetchAlerts } = useQuery({
    queryKey: ["net-lan-alerts", deviceId],
    queryFn: () => netAccessApi.lanAlerts(deviceId),
    enabled: !!deviceId && !browserOpen && canSessions,
    refetchInterval: browserOpen ? false : 30_000,
    refetchOnWindowFocus: false,
  });
  const alertList: any[] = (lanAlerts as any)?.alerts ?? [];




  const [portDraft, setPortDraft] = useState<Record<string, WebPortCfg>>({});
  useEffect(() => { if (ports) setPortDraft(ports as Record<string, WebPortCfg>); }, [ports]);

  // Precalienta el escritorio remoto del usuario al entrar a Red: cuando pulse
  // "Abrir", el contenedor VNC ya está arrancado y la pestaña abre al instante.
  useEffect(() => { if (canDesktop) browserApi.session().catch(() => undefined); }, [canDesktop]);


  const savePorts = useMutation({
    mutationFn: () => netAccessApi.setWebPorts(portDraft),
    onSuccess: () => {
      toast.success("Puertos web actualizados");
      qc.invalidateQueries({ queryKey: ["net-web-ports"] });
      qc.invalidateQueries({ queryKey: ["net-equipos"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar los puertos"),
  });


  // Conserva la última lista no vacía: si un refresco llega vacío por un
  // corte momentáneo de la VPN, la tabla no se queda en blanco.
  const lastSecretsRef = useRef<any[]>([]);
  if (pppoe?.secrets?.length) lastSecretsRef.current = pppoe.secrets;
  const secrets = pppoe?.secrets?.length ? pppoe.secrets : lastSecretsRef.current;

  // Buscadores independientes con paginación por sección.
  const pppoeSearch = usePagedSearch<any>(
    secrets,
    (s) => [s.name, s.profile, s.remote_address, s.comment, s.service, s.caller_id],
    { pageSize: 25 }
  );

  // Sin paginación en PPPoE: se muestran todos los resultados filtrados.
  const [ipSort, setIpSort] = useState<"asc" | "desc" | null>(null);

  const ipToNumber = (ip?: string | null) => {
    if (!ip) return -1;
    const parts = String(ip).split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return -1;
    return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
  };

  const filteredSecrets = useMemo(() => {
    const list = [...pppoeSearch.filtered];
    if (!ipSort) return list;
    return list.sort((a, b) => {
      const diff = ipToNumber(a.remote_address) - ipToNumber(b.remote_address);
      return ipSort === "asc" ? diff : -diff;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pppoeSearch.filtered, ipSort]);

  // ─── Edición separada del secret PPPoE ───
  const [editSecret, setEditSecret] = useState<any | null>(null);
  const [editMode, setEditMode] = useState<"comment" | "profile">("comment");
  const [editComment, setEditComment] = useState("");
  const [editProfile, setEditProfile] = useState("");

  const {
    data: pppoeProfilesRaw = [],
    isLoading: profilesLoading,
    isError: profilesError,
    refetch: refetchProfiles,
  } = useQuery({
    queryKey: ["net-pppoe-profiles", deviceId],
    queryFn: () => pppoeApi.profiles(deviceId),
    enabled: !!deviceId && !!editSecret && editMode === "profile",
    staleTime: 120_000,
    retry: 1,
  });

  // Fallback: si la consulta de perfiles falla o viene vacía, ofrece los
  // perfiles que ya usan los secretos cargados en la tabla.
  const pppoeProfiles = useMemo(() => {
    const list = Array.isArray(pppoeProfilesRaw) ? [...pppoeProfilesRaw] : [];
    const known = new Set(list.map((p: any) => p?.name).filter(Boolean));
    for (const s of pppoeSearch.filtered as any[]) {
      if (s?.profile && !known.has(s.profile)) {
        known.add(s.profile);
        list.push({ name: s.profile });
      }
    }
    return list;
  }, [pppoeProfilesRaw, pppoeSearch.filtered]);

  const updateCommentMut = useMutation({
    mutationFn: () => netAccessApi.updatePppoeComment(deviceId, String(editSecret.id), editComment),
    onSuccess: async () => {
      toast.success("Comentario guardado y verificado en la MikroTik");
      setEditSecret(null);
      await refetchPppoe();
    },
    onError: (e: any) => toast.error("No se pudo guardar el comentario", { description: e?.message }),
  });

  const updateProfileMut = useMutation({
    mutationFn: () => netAccessApi.updatePppoeProfile(deviceId, String(editSecret.id), editProfile),
    onSuccess: async (data: any) => {
      toast.success("Perfil guardado y verificado", {
        description: data?.kicked ? "La sesión se reconectó para aplicar el perfil." : undefined,
      });
      setEditSecret(null);
      // Si la sesión fue reconectada, deja que RouterOS la registre antes de
      // volver a leer la tabla para mostrar el perfil y estado nuevos.
      if (data?.kicked) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      }
      await Promise.all([refetchPppoe(), refetchEvents()]);
    },
    onError: (e: any) => toast.error("No se pudo cambiar el perfil", { description: e?.message }),
  });

  const openEditSecret = (s: any, mode: "comment" | "profile") => {
    setEditSecret(s);
    setEditMode(mode);
    setEditComment(s.comment || "");
    setEditProfile(s.profile || "");
  };

  const openWebFig = async () => {
    try {
      const info = await netAccessApi.webfig(deviceId);
      setBrowserTarget({
        title: `WebFig — ${info.host}:${info.port}`,
        directUrl: info.direct_url || `http://${info.host}:${info.port}/`,
        proxyUrl: proxyUrl(info.proxy_path),
        mikrotikId: deviceId,
      });
    } catch (e: any) {
      toast.error(e.message || "No se pudo abrir WebFig");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64 min-w-0 p-4 md:p-8 pt-20 md:pt-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RouterIcon className="w-6 h-6 text-primary" />
              Conexión MikroTik
            </h1>
            <p className="text-sm text-muted-foreground">
              PPPoE, equipos de la red y acceso web (WebFig / antenas) a través de la VPN.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Selecciona el router" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name} ({d.host})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => { if (canSessions) refetchPppoe(); qc.invalidateQueries({ queryKey: ["cpes"] }); }}>
              <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
            </Button>
            {canDesktop && (
              <Button onClick={openWebFig} disabled={!deviceId}>
                <Monitor className="w-4 h-4 mr-2" /> Abrir WebFig
              </Button>
            )}
            {canDesktop && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await browserApi.session();
                    window.open(remoteDesktopUrl('browser'), "_blank", "noopener");
                  } catch (e: any) {
                    toast.error(e?.message || "No se pudo iniciar tu escritorio remoto");
                  }
                }}

                title="Escritorio remoto (VNC) con Chromium real dentro del VPS, por la VPN"
              >
                <Globe className="w-4 h-4 mr-2" /> Escritorio remoto (VNC)
              </Button>
            )}
            {canWinbox && (
              <Button
                variant="secondary"
                disabled={openingWinbox}
                onClick={async () => {
                  const address = winboxRouters.find((r) => r.id === deviceId)?.address;
                  setOpeningWinbox(true);
                  try {
                    if (address) {
                      // El router mismo: dirección sin el puerto WinBox de las antenas
                      toast.success(winboxReadyText(await openWinboxTo(deviceId, address, true)));
                    } else {
                      await openWinbox();
                    }
                  } catch (e: any) {
                    toast.error(e?.message || "No se pudo abrir WinBox");
                  } finally {
                    setOpeningWinbox(false);
                  }
                }}
                title="WinBox 4 dentro del VPS, por la VPN (con RoMON hacia las antenas)"
              >
                {openingWinbox ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MonitorCog className="w-4 h-4 mr-2" />} WinBox
              </Button>
            )}
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar usuario, IP, MAC o marca…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {alertList.length > 0 && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3 pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  {alertList.length} alerta{alertList.length === 1 ? "" : "s"} de enlace LAN
                </CardTitle>
                <CardDescription>
                  {(lanAlerts as any).ports_down} puerto(s) del router sin cable · {(lanAlerts as any).clients_down} cliente(s) sin enlace
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchAlerts()} disabled={fetchingAlerts}>
                {fetchingAlerts ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {alertList.slice(0, 6).map((a: any, i: number) => (
                <div key={`${a.type}-${a.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className={
                    a.severity === "critica"
                      ? "bg-destructive/15 text-destructive border-destructive/30"
                      : a.severity === "alta"
                        ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                        : "bg-muted text-muted-foreground"
                  }>
                    {a.type === "puerto" ? <PlugZap className="w-3 h-3 mr-1" /> : <Cable className="w-3 h-3 mr-1" />}
                    {a.type === "puerto" ? "Router" : "Cliente"}
                  </Badge>
                  <span className="font-medium">{a.name}</span>
                  {a.comment && <span className="text-muted-foreground">({a.comment})</span>}
                  <span className="text-muted-foreground">{a.message}</span>
                  {a.address && <span className="text-xs text-muted-foreground">IP {a.address}</span>}
                </div>
              ))}
              {alertList.length > 6 && (
                <p className="text-xs text-muted-foreground">
                  y {alertList.length - 6} más — revisa la pestaña “Alertas LAN”.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={canSessions ? "pppoe" : "cpes"}>
          <TabsList>
            {canSessions && <TabsTrigger value="pppoe"><Users className="w-4 h-4 mr-2" />PPPoE</TabsTrigger>}
            {canSessions && <TabsTrigger value="alertas">
              <AlertTriangle className="w-4 h-4 mr-2" />Alertas LAN
              {alertList.length > 0 && (
                <Badge variant="outline" className="ml-2 bg-destructive/15 text-destructive border-destructive/30">
                  {alertList.length}
                </Badge>
              )}
            </TabsTrigger>}
            {canSessions && <TabsTrigger value="desconexiones"><Activity className="w-4 h-4 mr-2" />Desconexiones</TabsTrigger>}
            {canRed && <TabsTrigger value="cpes"><Antenna className="w-4 h-4 mr-2" />Antenas cliente</TabsTrigger>}
            {canSessions && <TabsTrigger value="cableado"><Cable className="w-4 h-4 mr-2" />Cableado LAN</TabsTrigger>}
            {isFull && <TabsTrigger value="puertos"><Wifi className="w-4 h-4 mr-2" />Puertos web</TabsTrigger>}
          </TabsList>

          {/* ─── Alertas LAN ─── */}
          <TabsContent value="alertas" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Clientes y puertos con cable desconectado
                </CardTitle>
                <CardDescription>
                  Se revisa cada 30 s el enlace de los puertos del router y las sesiones PPPoE de los clientes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!alertList.length ? (
                  <p className="text-sm text-muted-foreground">Sin alertas: todos los enlaces están activos.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-2 pr-3">Origen</th>
                          <th className="py-2 pr-3">Nombre</th>
                          <th className="py-2 pr-3">Detalle</th>
                          <th className="py-2 pr-3">IP</th>
                          <th className="py-2 pr-3">Sin enlace</th>
                          <th className="py-2 pr-3">Severidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertList
                          .filter((a: any) =>
                            !search || `${a.name} ${a.comment || ""} ${a.address || ""}`.toLowerCase().includes(search.toLowerCase())
                          )
                          .map((a: any, i: number) => (
                            <tr key={`row-${a.type}-${a.name}-${i}`} className="border-b last:border-0">
                              <td className="py-2 pr-3">{a.type === "puerto" ? "Router" : "Cliente"}</td>
                              <td className="py-2 pr-3 font-medium">
                                {a.name}
                                {a.comment && <span className="block text-xs text-muted-foreground">{a.comment}</span>}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{a.message}</td>
                              <td className="py-2 pr-3">{a.address || "—"}</td>
                              <td className="py-2 pr-3">
                                {a.minutes_down != null
                                  ? a.minutes_down >= 60
                                    ? `${Math.floor(a.minutes_down / 60)} h ${a.minutes_down % 60} min`
                                    : `${a.minutes_down} min`
                                  : "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <Badge variant="outline" className={
                                  a.severity === "critica"
                                    ? "bg-destructive/15 text-destructive border-destructive/30"
                                    : a.severity === "alta"
                                      ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                      : "bg-muted text-muted-foreground"
                                }>
                                  {a.severity}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          {/* ─── PPPoE ─── */}
          <TabsContent value="pppoe" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">Usuarios PPPoE</CardTitle>
                  <CardDescription>
                    {pppoe
                      ? `${pppoe.active_count} en línea de ${pppoe.total}` +
                        (pppoe.radius_sessions
                          ? ` · ${pppoe.radius_sessions} sesiones sin secreto local (RADIUS)`
                          : "")
                      : "Consultando el router por VPN…"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <SearchBox
                  controls={pppoeSearch}
                  placeholder="Buscar por usuario, IP, perfil o comentario…"
                  className="mb-3"
                />

                {pppoeError ? (
                  <p className="text-sm text-destructive">{(pppoeError as any).message}</p>
                ) : loadingPppoe ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-4">Usuario</th>
                          <th className="py-2 pr-4">Comentario</th>
                          <th className="py-2 pr-4">Estado</th>
                          <th className="py-2 pr-4">
                            <button
                              type="button"
                              onClick={() => setIpSort(ipSort === "asc" ? "desc" : ipSort === "desc" ? null : "asc")}
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                              title="Ordenar por IP (clic para cambiar)"
                            >
                              IP
                              {ipSort === "asc" ? (
                                <ArrowUp className="w-3.5 h-3.5" />
                              ) : ipSort === "desc" ? (
                                <ArrowDown className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowUpDown className="w-3.5 h-3.5 opacity-50" />
                              )}
                            </button>
                          </th>
                          <th className="py-2 pr-4">MAC</th>
                          <th className="py-2 pr-4">Perfil</th>
                          <th className="py-2 pr-4">Uptime</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSecrets.map((s: any, i: number) => (
                          <tr key={`${s.source || "secret"}-${s.id || "n"}-${s.name}-${i}`} className="border-b last:border-0">

                            <td className="py-2 pr-4 font-medium">
                              <div className="flex items-center gap-1.5">
                                <span>{s.name}</span>
                                {s.remote_address ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    title={`Abrir interfaz web de ${s.name}`}
                                    onClick={() =>
                                      setBrowserTarget({
                                        title: `${s.name} — ${s.remote_address}`,
                                        directUrl: `http://${s.remote_address}:${portDraft.otro?.port || 80}/`,
                                        proxyUrl: proxyUrl(
                                          `/api/netaccess/${deviceId}/web/${s.remote_address}/${portDraft.otro?.port || 80}/`
                                        ),
                                        mikrotikId: deviceId,
                                      })
                                    }
                                  >
                                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> Abrir
                                  </Button>
                                ) : null}
                                {s.remote_address && canWinbox ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    title={`Abrir ${s.name} en tu WinBox remoto (deja ${s.remote_address} listo para Ctrl+V en "Connect to")`}
                                    onClick={() => openWinboxClient(s.remote_address)}
                                  >
                                    <Monitor className="w-3.5 h-3.5 mr-1" /> WinBox
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground max-w-[220px] truncate" title={s.comment || ""}>
                              <div className="flex items-center gap-1">
                                <span className="truncate">{s.comment || "—"}</span>
                                {canEditRed && s.source === "secret" && s.id && (
                                  <Button size="sm" variant="ghost" title="Editar comentario" onClick={() => openEditSecret(s, "comment")}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              <Badge variant={s.online ? "default" : "secondary"}>
                                {s.online ? "En línea" : s.disabled ? "Deshabilitado" : "Offline"}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">{s.remote_address || "—"}</td>
                            <td className="py-2 pr-4 font-mono text-xs">{s.caller_id || "—"}</td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-1">
                                <span>{s.profile || "—"}</span>
                                {canEditRed && s.source === "secret" && s.id && (
                                  <Button size="sm" variant="ghost" title="Cambiar perfil" onClick={() => openEditSecret(s, "profile")}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-4">{s.uptime || "—"}</td>
                          </tr>
                        ))}
                        {!filteredSecrets.length && (
                          <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Sin usuarios PPPoE</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Desconexiones PPPoE ─── */}
          <TabsContent value="desconexiones" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Informe de desconexiones PPPoE
                  </CardTitle>
                  <CardDescription>
                    El sistema revisa las sesiones activas cada minuto y registra cada caída. Aquí ves qué clientes se desconectan con más frecuencia.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={eventDays} onValueChange={setEventDays}>
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Últimas 24 h</SelectItem>
                      <SelectItem value="7">7 días</SelectItem>
                      <SelectItem value="15">15 días</SelectItem>
                      <SelectItem value="30">30 días</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => refetchEvents()} disabled={fetchingEvents}>
                    <RefreshCw className={`w-4 h-4 ${fetchingEvents ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {eventsError ? (
                  <p className="text-sm text-destructive">{(eventsError as any).message}</p>
                ) : loadingEvents ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cargando informe…
                  </p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3 mb-4">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Desconexiones</p>
                        <p className="text-xl font-semibold">{(pppoeEvents as any)?.total_disconnections ?? 0}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Clientes afectados</p>
                        <p className="text-xl font-semibold">{(pppoeEvents as any)?.affected_clients ?? 0}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Clientes inestables</p>
                        <p className="text-xl font-semibold text-destructive">{(pppoeEvents as any)?.unstable_clients ?? 0}</p>
                      </div>
                    </div>

                    {!((pppoeEvents as any)?.clients?.length) ? (
                      <p className="text-sm text-muted-foreground">
                        Aún no hay desconexiones registradas en este periodo. El historial se construye desde que el monitor empieza a correr.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs text-muted-foreground border-b">
                            <tr>
                              <th className="text-left py-2 pr-3">Cliente</th>
                              <th className="text-left py-2 pr-3">Caídas</th>
                              <th className="text-left py-2 pr-3">Prom./día</th>
                              <th className="text-left py-2 pr-3">Última caída</th>
                              <th className="text-left py-2 pr-3">IP</th>
                              <th className="text-left py-2">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {((pppoeEvents as any).clients as any[])
                              .filter((c) => !search || c.username?.toLowerCase().includes(search.toLowerCase()))
                              .map((c) => (
                                <tr key={c.username} className="border-b last:border-0">
                                  <td className="py-2 pr-3 font-medium">{c.username}</td>
                                  <td className="py-2 pr-3">
                                    <Badge
                                      variant="outline"
                                      className={
                                        c.severity === "critica"
                                          ? "bg-destructive/15 text-destructive border-destructive/30"
                                          : c.severity === "alta"
                                          ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                          : c.severity === "media"
                                          ? "bg-sky-500/15 text-sky-500 border-sky-500/30"
                                          : "bg-muted text-muted-foreground"
                                      }
                                    >
                                      {c.disconnections}
                                    </Badge>
                                  </td>
                                  <td className="py-2 pr-3">{c.per_day}</td>
                                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                                    {c.last_down ? new Date(c.last_down).toLocaleString() : "—"}
                                  </td>
                                  <td className="py-2 pr-3 font-mono text-xs">{c.address || "—"}</td>
                                  <td className="py-2">
                                    <span className={c.is_online ? "text-emerald-500" : "text-destructive"}>
                                      {c.is_online ? "En línea" : "Caído"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {!!((pppoeEvents as any)?.recent?.length) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Últimos eventos</CardTitle>
                  <CardDescription>Historial cronológico de conexiones y caídas.</CardDescription>
                </CardHeader>
                <CardContent className="max-h-[420px] overflow-y-auto">
                  <div className="space-y-1">
                    {((pppoeEvents as any).recent as any[]).map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5 gap-3">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${e.event === "up" ? "bg-emerald-500" : "bg-destructive"}`}
                          />
                          <span className="font-medium truncate">{e.username}</span>
                          <span className="text-muted-foreground text-xs">
                            {e.event === "up" ? "conectó" : "se desconectó"}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>


          {/* ─── Equipos ─── */}
          {/* ─── Antenas de clientes: acceso por SSH y cambios en lote ─── */}
          <TabsContent value="cpes" className="mt-4">
            {deviceId ? <CpePanel deviceId={deviceId} /> : <p className="text-sm text-muted-foreground">Selecciona un MikroTik.</p>}
          </TabsContent>

          {/* ─── Cableado LAN ─── */}
          <TabsContent value="cableado" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Cable className="w-4 h-4" /> Estado del cableado
                  </CardTitle>
                  <CardDescription>
                    Enlace de cada puerto Ethernet del MikroTik: conectado/desconectado, base 10/100/1000, dúplex, errores y caídas de enlace.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetchEth()} disabled={fetchingEth}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${fetchingEth ? "animate-spin" : ""}`} /> Actualizar
                </Button>
              </CardHeader>
              <CardContent>
                {ethError ? (
                  <p className="text-sm text-destructive">{(ethError as any).message}</p>
                ) : loadingEth ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Leyendo puertos…
                  </p>
                ) : !((ethernet as any)?.ports?.length) ? (
                  <p className="text-muted-foreground text-sm">No se obtuvieron puertos Ethernet del router.</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3 mb-4">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Puertos</p>
                        <p className="text-xl font-semibold">{(ethernet as any).total}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Con enlace</p>
                        <p className="text-xl font-semibold text-emerald-500">{(ethernet as any).connected}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Con fallas</p>
                        <p className="text-xl font-semibold text-destructive">{(ethernet as any).with_errors}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {((ethernet as any).ports as any[]).map((p) => (
                        <div key={p.id || p.name} className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium truncate flex items-center gap-2">
                                <PlugZap className={`w-4 h-4 ${p.connected ? "text-emerald-500" : "text-muted-foreground"}`} />
                                {p.name}
                              </p>
                              {p.comment && <p className="text-xs text-muted-foreground truncate">{p.comment}</p>}
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                p.health === "ok"
                                  ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                                  : p.health === "degradado"
                                  ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                  : p.health === "fallo"
                                  ? "bg-destructive/15 text-destructive border-destructive/30"
                                  : "bg-muted text-muted-foreground"
                              }
                            >
                              {p.health === "ok"
                                ? "Conectado"
                                : p.health === "degradado"
                                ? "Velocidad baja"
                                : p.health === "fallo"
                                ? "Con fallas"
                                : "Desconectado"}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Base: </span>
                              <span className="font-medium">
                                {p.speed_mbps ? `${p.speed_mbps} Mbps${p.duplex ? ` ${p.duplex}` : ""}` : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Caídas: </span>
                              <span className={p.link_downs > 3 ? "text-destructive font-medium" : "font-medium"}>
                                {p.link_downs}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Errores RX/TX: </span>
                              <span className="font-medium">{p.rx_errors}/{p.tx_errors}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Descartes: </span>
                              <span className="font-medium">{p.rx_drops}/{p.tx_drops}</span>
                            </div>
                          </div>

                          {(p.last_link_down || p.last_link_up) && (
                            <p className="text-[11px] text-muted-foreground">
                              {p.last_link_up && <>Último enlace: {p.last_link_up}. </>}
                              {p.last_link_down && <>Última caída: {p.last_link_down}</>}
                            </p>
                          )}

                          {p.health === "fallo" && (
                            <p className="text-[11px] text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Revisa el cable/conector: hay errores o caídas frecuentes.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          {/* ─── Puertos ─── */}
          <TabsContent value="puertos" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Puerto web por marca</CardTitle>
                <CardDescription>
                  Define en qué puerto y protocolo se abre la interfaz web de cada marca dentro del panel.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.keys(BRAND_LABEL).map((brand) => {
                    const cfg = portDraft[brand] || { port: 80, protocol: "http" as const };
                    return (
                      <div key={brand} className="space-y-1.5">
                        <Label className="text-xs">{BRAND_LABEL[brand]}</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={65535}
                            value={cfg.port}
                            onChange={(e) =>
                              setPortDraft({ ...portDraft, [brand]: { ...cfg, port: Number(e.target.value) } })
                            }
                          />
                          <Select
                            value={cfg.protocol}
                            onValueChange={(v) =>
                              setPortDraft({ ...portDraft, [brand]: { ...cfg, protocol: v as "http" | "https" } })
                            }
                          >
                            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="http">HTTP</SelectItem>
                              <SelectItem value="https">HTTPS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Puerto WinBox de las antenas MikroTik de los clientes (todo el ISP) */}
                <div className="space-y-1.5 max-w-xs">
                  <Label className="text-xs">WinBox de las antenas MikroTik (puerto)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={portDraft.winbox?.port ?? 8291}
                    onChange={(e) =>
                      setPortDraft({ ...portDraft, winbox: { port: Number(e.target.value), protocol: "http" } })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    El botón "WinBox" de Antenas cliente copia IP:puerto con este valor (8291 de fábrica).
                  </p>
                </div>
                <Button onClick={() => savePorts.mutate()} disabled={savePorts.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Guardar puertos
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <ProxyBrowserDialog target={browserTarget} onOpenChange={(open) => !open && setBrowserTarget(null)} />
        <Dialog open={!!editSecret} onOpenChange={(open) => !open && setEditSecret(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
               <DialogTitle>{editMode === "comment" ? "Editar comentario" : "Cambiar perfil"} — {editSecret?.name}</DialogTitle>
              <DialogDescription>
                 {editMode === "comment"
                   ? "Guarda únicamente el comentario directamente en el secret de la MikroTik."
                   : "Cambia únicamente el perfil del secret. La sesión activa reconecta para aplicarlo."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {editMode === "comment" ? <div className="space-y-1.5">
                <Label htmlFor="edit-pppoe-comment">Comentario</Label>
                <Input
                  id="edit-pppoe-comment"
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                  placeholder="Ej: Cliente Juan Pérez — Casa verde"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div> : <div className="space-y-1.5">
                <Label>Perfil PPPoE</Label>
                {profilesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cargando perfiles de la MikroTik…
                  </div>
                ) : (
                  <Select value={editProfile} onValueChange={setEditProfile}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      {editProfile && !pppoeProfiles.some((p: any) => p.name === editProfile) && (
                        <SelectItem value={editProfile}>{editProfile} (actual)</SelectItem>
                      )}
                      {(pppoeProfiles as any[]).map((p: any) => (
                        <SelectItem key={p[".id"] || p.id || p.name} value={p.name}>
                          {p.name}{p["rate-limit"] ? ` — ${p["rate-limit"]}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {profilesError && (
                  <div className="flex items-center justify-between gap-2 text-xs text-amber-500">
                    <span>No se pudieron leer los perfiles del router (se muestran los perfiles en uso).</span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => refetchProfiles()}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Reintentar
                    </Button>
                  </div>
                )}
              </div>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditSecret(null)}>Cancelar</Button>
              <Button
                onClick={() => editMode === "comment" ? updateCommentMut.mutate() : updateProfileMut.mutate()}
                disabled={updateCommentMut.isPending || updateProfileMut.isPending || (editMode === "profile" && !editProfile)}
              >
                {updateCommentMut.isPending || updateProfileMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {editMode === "comment" ? "Guardar comentario" : "Aplicar perfil"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </main>
    </div>
  );
}
