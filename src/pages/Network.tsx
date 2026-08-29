import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { devicesApi, netAccessApi, getApiBaseUrl } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Router as RouterIcon, Users, Wifi, Search, RefreshCw, ExternalLink,
  Monitor, Save, Loader2, Antenna, SignalHigh, KeyRound, Plus, Trash2,
} from "lucide-react";
import { ApSignalDialog, type ApTargetInfo } from "@/components/network/ApSignalDialog";

const AP_QUALITY: Record<string, { label: string; className: string }> = {
  excelente: { label: "Excelente", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  buena: { label: "Buena", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  regular: { label: "Regular", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  mala: { label: "Mala", className: "bg-destructive/15 text-destructive border-destructive/30" },
  desconocida: { label: "Sin datos", className: "bg-muted text-muted-foreground" },
};

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
  return `${base}${path}`;
};

export default function Network() {
  const qc = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("mikrotik_device_id") || "");
  const [search, setSearch] = useState("");
  const [embed, setEmbed] = useState<{ title: string; url: string } | null>(null);
  const [signalAp, setSignalAp] = useState<ApTargetInfo | null>(null);

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
    enabled: !!deviceId,
    refetchInterval: 30_000,
  });

  const { data: netDevices, isLoading: loadingNet, refetch: refetchNet, error: netError } = useQuery({
    queryKey: ["net-equipos", deviceId],
    queryFn: () => netAccessApi.devices(deviceId),
    enabled: !!deviceId,
  });

  const { data: ports } = useQuery({
    queryKey: ["net-web-ports"],
    queryFn: () => netAccessApi.getWebPorts(),
  });

  const [portDraft, setPortDraft] = useState<Record<string, WebPortCfg>>({});
  useEffect(() => { if (ports) setPortDraft(ports as Record<string, WebPortCfg>); }, [ports]);

  const savePorts = useMutation({
    mutationFn: () => netAccessApi.setWebPorts(portDraft),
    onSuccess: () => {
      toast.success("Puertos web actualizados");
      qc.invalidateQueries({ queryKey: ["net-web-ports"] });
      qc.invalidateQueries({ queryKey: ["net-equipos"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar los puertos"),
  });

  const secrets = pppoe?.secrets ?? [];
  const equipos = netDevices?.devices ?? [];

  const filteredSecrets = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return secrets;
    return secrets.filter((s: any) =>
      [s.name, s.profile, s.remote_address, s.comment].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [secrets, search]);

  const filteredEquipos = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return equipos;
    return equipos.filter((d: any) =>
      [d.ip, d.mac, d.name, d.platform, d.brand].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [equipos, search]);

  const openWebFig = async () => {
    try {
      const info = await netAccessApi.webfig(deviceId);
      setEmbed({ title: `WebFig — ${info.host}:${info.port}`, url: proxyUrl(info.proxy_path) });
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
            <Button variant="outline" onClick={() => { refetchPppoe(); refetchNet(); }}>
              <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
            </Button>
            <Button onClick={openWebFig} disabled={!deviceId}>
              <Monitor className="w-4 h-4 mr-2" /> Abrir WebFig
            </Button>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar usuario, IP, MAC o marca…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Tabs defaultValue="pppoe">
          <TabsList>
            <TabsTrigger value="pppoe"><Users className="w-4 h-4 mr-2" />PPPoE</TabsTrigger>
            <TabsTrigger value="equipos"><Antenna className="w-4 h-4 mr-2" />Equipos / Antenas</TabsTrigger>
            <TabsTrigger value="puertos"><Wifi className="w-4 h-4 mr-2" />Puertos web</TabsTrigger>
          </TabsList>

          {/* ─── PPPoE ─── */}
          <TabsContent value="pppoe" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">Usuarios PPPoE</CardTitle>
                  <CardDescription>
                    {pppoe ? `${pppoe.active_count} en línea de ${pppoe.total}` : "Consultando el router por VPN…"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
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
                          <th className="py-2 pr-4">Estado</th>
                          <th className="py-2 pr-4">IP</th>
                          <th className="py-2 pr-4">Perfil</th>
                          <th className="py-2 pr-4">Uptime</th>
                          <th className="py-2">Acceso web</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSecrets.map((s: any) => (
                          <tr key={s.id || s.name} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{s.name}</td>
                            <td className="py-2 pr-4">
                              <Badge variant={s.online ? "default" : "secondary"}>
                                {s.online ? "En línea" : s.disabled ? "Deshabilitado" : "Offline"}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">{s.remote_address || "—"}</td>
                            <td className="py-2 pr-4">{s.profile || "—"}</td>
                            <td className="py-2 pr-4">{s.uptime || "—"}</td>
                            <td className="py-2">
                              {s.remote_address ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setEmbed({
                                      title: `${s.name} — ${s.remote_address}`,
                                      url: proxyUrl(
                                        `/api/netaccess/${deviceId}/web/${s.remote_address}/${portDraft.otro?.port || 80}/`
                                      ),
                                    })
                                  }
                                >
                                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> Abrir
                                </Button>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                        {!filteredSecrets.length && (
                          <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Sin usuarios PPPoE</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Equipos ─── */}
          <TabsContent value="equipos" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equipos detectados en la red</CardTitle>
                <CardDescription>
                  Antenas Ubiquiti, routers MikroTik y CPEs vistos por vecinos, ARP y DHCP. Se abren con el puerto configurado por marca.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {netError ? (
                  <p className="text-sm text-destructive">{(netError as any).message}</p>
                ) : loadingNet ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Escaneando…
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filteredEquipos.map((d: any) => (
                      <div key={d.ip} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{d.name}</p>
                            <p className="text-xs font-mono text-muted-foreground">{d.ip}</p>
                          </div>
                          <Badge variant={d.brand === "otro" ? "secondary" : "default"} className="capitalize shrink-0">
                            {d.brand}
                          </Badge>
                        </div>
                        {d.platform && <p className="text-xs text-muted-foreground truncate">{d.platform}</p>}
                        <p className="text-xs text-muted-foreground">
                          {d.web_protocol}://{d.ip}:{d.web_port}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="flex-1"
                            onClick={() => setSignalAp({ ip: d.ip, brand: d.brand, name: d.name })}
                          >
                            <SignalHigh className="w-3.5 h-3.5 mr-1" /> Señal
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setEmbed({ title: `${d.name} — ${d.ip}:${d.web_port}`, url: proxyUrl(d.proxy_path) })}
                          >
                            <Monitor className="w-3.5 h-3.5 mr-1" /> Abrir
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!filteredEquipos.length && (
                      <p className="text-muted-foreground">No se detectaron equipos.</p>
                    )}
                  </div>
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
                <Button onClick={() => savePorts.mutate()} disabled={savePorts.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Guardar puertos
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!embed} onOpenChange={(o) => !o && setEmbed(null)}>
          <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col p-0">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="text-base flex items-center gap-2">
                <Monitor className="w-4 h-4" /> {embed?.title}
              </DialogTitle>
            </DialogHeader>
            {embed && (
              <iframe
                title={embed.title}
                src={embed.url}
                className="flex-1 w-full border-0 rounded-b-lg bg-white"
              />
            )}
          </DialogContent>
        </Dialog>

        <ApSignalDialog
          mikrotikId={deviceId}
          target={signalAp}
          onOpenChange={(open) => !open && setSignalAp(null)}
        />
      </main>
    </div>
  );
}
