import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { onuWebApi, netAccessApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TopologyTree } from "@/components/network/TopologyTree";
import { AdvancedWeb, type AdvancedTarget } from "@/components/network/AdvancedWeb";
import { Globe, Wifi, KeyRound, Search, Save, Trash2, ShieldCheck, History, MonitorCog, Radio, Check, Network } from "lucide-react";

const BRANDS = ["zyxel", "huawei", "zte", "vsol", "cdata", "fiberhome", "tplink", "ubiquiti", "mikrotik", "mimosa", "cambium", "otro"];

/**
 * Acceso web directo a ONUs: el VPS entra por la VPN a la interfaz web de la ONU
 * y solo modifica WiFi y PPPoE. Lo aprendido de un modelo se reutiliza en los demás.
 */
export default function OnuWeb() {
  const qc = useQueryClient();
  const mikrotikId = localStorage.getItem("mikrotik_device_id") || "";
  const [tab, setTab] = useState("equipos");
  const [ip, setIp] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [probeResult, setProbeResult] = useState<any>(null);
  const [profileName, setProfileName] = useState("");
  const [wifi, setWifi] = useState({ ssid: "", password: "" });
  const [pppoe, setPppoe] = useState({ username: "", password: "" });
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [cred, setCred] = useState({ ip: "", name: "", username: "admin", password: "", port: "", protocol: "http" });
  const [newPass, setNewPass] = useState<Record<string, string>>({});
  const [profileBrand, setProfileBrand] = useState("otro");
  const [advanced, setAdvanced] = useState<AdvancedTarget | null>(null);

  const { data: pppoeData } = useQuery({
    queryKey: ["mini-pppoe", mikrotikId],
    queryFn: () => netAccessApi.pppoe(mikrotikId),
    enabled: !!mikrotikId,
    refetchInterval: 30000,
  });
  const { data: devicesData } = useQuery({
    queryKey: ["mini-devices", mikrotikId],
    queryFn: () => netAccessApi.devices(mikrotikId),
    enabled: !!mikrotikId,
    refetchInterval: 30000,
  });

  const changePppoePass = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      netAccessApi.setPppoePassword(mikrotikId, id, password, true),
    onSuccess: (_d: any, vars) => {
      toast.success("Clave PPPoE actualizada en el MikroTik (sesión reiniciada)");
      setNewPass((p) => ({ ...p, [vars.id]: "" }));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const manageDevice = (deviceIp: string) => {
    setIp(deviceIp);
    setTab("gestion");
    probe.mutate({ ip: deviceIp });
  };

  const { data: credentials = [] } = useQuery({
    queryKey: ["onu-web-credentials"],
    queryFn: onuWebApi.listCredentials,
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["onu-web-profiles"],
    queryFn: onuWebApi.listProfiles,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["onu-web-events"],
    queryFn: onuWebApi.events,
    refetchInterval: 30000,
  });

  const probe = useMutation({
    mutationFn: (target?: { ip: string }) =>
      onuWebApi.probe({ ip: target?.ip || ip, username: user || undefined, password: pass || undefined }),
    onSuccess: (data: any) => {
      setProbeResult(data);
      setSelectedProfile(data?.matched_profile?.id || "");
      setProfileName(data?.matched_profile?.name || `${data?.detected?.brand || "onu"} ${data?.detected?.model || ""}`.trim());
      setProfileBrand(data?.matched_profile?.brand || data?.detected?.brand || "otro");
      toast.success(data?.matched_profile ? "Modelo reconocido: perfil existente aplicado" : "ONU detectada, revisa el perfil sugerido");
    },
    onError: (e: any) => toast.error(e.message || "No se pudo alcanzar la ONU"),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      onuWebApi.createProfile({
        name: profileName,
        ...probeResult?.suggestion,
        brand: profileBrand,
        learned_from: ip,
      }),
    onSuccess: (data: any) => {
      setSelectedProfile(data?.id || "");
      qc.invalidateQueries({ queryKey: ["onu-web-profiles"] });
      toast.success("Perfil guardado: se reutilizará en todas las ONUs de este modelo");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: () =>
      onuWebApi.apply({
        ip,
        username: user || undefined,
        password: pass || undefined,
        profile_id: selectedProfile || undefined,
        wifi: wifi.ssid || wifi.password ? wifi : undefined,
        pppoe: pppoe.username || pppoe.password ? pppoe : undefined,
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["onu-web-events"] });
      if (data?.success) toast.success("Configuración aplicada en la ONU");
      else toast.error("La ONU respondió con errores, revisa el historial");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCred = useMutation({
    mutationFn: () => onuWebApi.saveCredentials({ ...cred, port: cred.port ? Number(cred.port) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onu-web-credentials"] });
      setCred({ ip: "", name: "", username: "admin", password: "", port: "", protocol: "http" });
      toast.success("Credencial guardada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delCred = useMutation({
    mutationFn: (id: string) => onuWebApi.deleteCredentials(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onu-web-credentials"] }),
  });

  const delProfile = useMutation({
    mutationFn: (id: string) => onuWebApi.deleteProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onu-web-profiles"] }),
  });

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" /> Mini-panel de equipos
          </h1>
          <p className="text-sm text-muted-foreground">
            Un solo panel para antenas y ONUs: cambia claves PPPoE en el MikroTik y entra por la VPN
            a la web de cada equipo para configurar WiFi y PPPoE. Cada modelo se aprende una vez y se reutiliza.
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="equipos">Equipos</TabsTrigger>
            <TabsTrigger value="topologia">Topología</TabsTrigger>
            <TabsTrigger value="gestion">Gestionar equipo</TabsTrigger>
            <TabsTrigger value="credenciales">Credenciales</TabsTrigger>
            <TabsTrigger value="perfiles">Perfiles aprendidos</TabsTrigger>
            <TabsTrigger value="avanzado">Sistema avanzado</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>

          {/* ── Equipos detectados + clientes PPPoE ───── */}
          <TabsContent value="equipos" className="space-y-4">
            {!mikrotikId && (
              <Card><CardContent className="py-6 text-sm text-muted-foreground">Selecciona un MikroTik en Ajustes para ver los equipos de la red.</CardContent></Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> Clientes PPPoE (cambio de clave en el MikroTik)
                </CardTitle>
                <CardDescription>La clave se cambia directo en el router por la VPN y la sesión se reinicia.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Nueva clave</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pppoeData?.secrets || []).map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>
                          {s.online ? <Badge>Conectado</Badge> : <Badge variant="outline">Desconectado</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{s.remote_address || "—"}</TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-36"
                            placeholder="Nueva clave"
                            value={newPass[s.id] || ""}
                            onChange={(e) => setNewPass({ ...newPass, [s.id]: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={(newPass[s.id] || "").length < 4 || changePppoePass.isPending}
                            onClick={() => changePppoePass.mutate({ id: s.id, password: newPass[s.id] })}
                          >
                            <Check className="h-4 w-4 mr-1" /> Cambiar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!(pppoeData?.secrets || []).length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin secretos PPPoE o sin MikroTik seleccionado</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4" /> Equipos detectados en la red (antenas, ONUs, CPEs)
                </CardTitle>
                <CardDescription>Detectados vía PPPoE, DHCP, ARP y vecinos del MikroTik. "Gestionar" detecta el modelo y abre la configuración.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Detectado por</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(devicesData?.devices || []).map((d: any) => (
                      <TableRow key={d.ip}>
                        <TableCell className="font-mono text-xs">{d.ip}</TableCell>
                        <TableCell>{d.name}</TableCell>
                        <TableCell><Badge variant="secondary">{d.brand}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.source}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => manageDevice(d.ip)} disabled={probe.isPending}>
                              <MonitorCog className="h-4 w-4 mr-1" /> Gestionar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setAdvanced({ ip: d.ip, name: d.name, proxy_path: d.proxy_path }); setTab("avanzado"); }}
                            >
                              <Network className="h-4 w-4 mr-1" /> Avanzado
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!(devicesData?.devices || []).length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No se detectaron equipos</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Topología por sectores ────────────────── */}
          <TabsContent value="topologia" className="space-y-4">
            <TopologyTree
              mikrotikId={mikrotikId}
              onManage={(deviceIp) => manageDevice(deviceIp)}
              onAdvanced={(t) => { setAdvanced(t); setTab("avanzado"); }}
            />
          </TabsContent>

          {/* ── Sistema avanzado (WebFig / airOS / web ONU) ── */}
          <TabsContent value="avanzado" className="space-y-4">
            <AdvancedWeb
              target={advanced}
              devices={devicesData?.devices || []}
              onSelect={setAdvanced}
            />
          </TabsContent>

          {/* ── Gestión ───────────────────────────────── */}
          <TabsContent value="gestion" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="h-4 w-4" /> 1. Detectar la ONU
                </CardTitle>
                <CardDescription>
                  Usa las credenciales globales del ISP si no escribes otras.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>IP de la ONU</Label>
                    <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.82.3.59" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Usuario (opcional)</Label>
                    <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="admin" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contraseña (opcional)</Label>
                    <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button className="w-full" disabled={!ip || probe.isPending} onClick={() => probe.mutate(undefined)}>
                      {probe.isPending ? "Detectando…" : "Detectar modelo"}
                    </Button>
                  </div>
                </div>

                {probeResult && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">{probeResult.detected?.brand}</Badge>
                      <span className="text-muted-foreground">{probeResult.detected?.title || "sin título"}</span>
                      <Badge variant="outline">HTTP {probeResult.status}</Badge>
                      {probeResult.matched_profile ? (
                        <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Perfil: {probeResult.matched_profile.name}</Badge>
                      ) : (
                        <Badge variant="destructive">Modelo nuevo</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Formularios encontrados: {probeResult.forms?.length || 0} · Campos WiFi:{" "}
                      {Object.keys(probeResult.suggestion?.wifi_fields || {}).length} · Campos PPPoE:{" "}
                      {Object.keys(probeResult.suggestion?.pppoe_fields || {}).length}
                    </div>
                    {!probeResult.matched_profile && (
                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="space-y-1.5">
                          <Label>Nombre del perfil</Label>
                          <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-64" />
                          <select
                            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={profileBrand}
                            onChange={(e) => setProfileBrand(e.target.value)}
                          >
                            {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <Button variant="secondary" disabled={!profileName || saveProfile.isPending} onClick={() => saveProfile.mutate()}>
                          <Save className="h-4 w-4 mr-1" /> Guardar aprendizaje
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi className="h-4 w-4" /> 2. Configurar (solo WiFi y PPPoE)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Nombre WiFi (SSID)</Label>
                    <Input value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clave WiFi</Label>
                    <Input value={wifi.password} onChange={(e) => setWifi({ ...wifi, password: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Usuario PPPoE</Label>
                    <Input value={pppoe.username} onChange={(e) => setPppoe({ ...pppoe, username: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clave PPPoE</Label>
                    <Input value={pppoe.password} onChange={(e) => setPppoe({ ...pppoe, password: e.target.value })} />
                  </div>
                </div>
                <Separator />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>Perfil a usar</Label>
                    <select
                      className="h-10 w-64 rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedProfile}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                    >
                      <option value="">Automático / guardado</option>
                      {profiles.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.verified ? "✓" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button disabled={!ip || apply.isPending} onClick={() => apply.mutate()}>
                    {apply.isPending ? "Aplicando…" : "Aplicar en la ONU"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Credenciales ──────────────────────────── */}
          <TabsContent value="credenciales" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> Credenciales de acceso
                </CardTitle>
                <CardDescription>
                  Deja la IP vacía para la credencial global del ISP; añade IPs solo como excepción.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-6">
                  <Input placeholder="IP (vacío = global)" value={cred.ip} onChange={(e) => setCred({ ...cred, ip: e.target.value })} />
                  <Input placeholder="Nombre" value={cred.name} onChange={(e) => setCred({ ...cred, name: e.target.value })} />
                  <Input placeholder="Usuario" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} />
                  <Input placeholder="Contraseña" type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} />
                  <Input placeholder="Puerto" value={cred.port} onChange={(e) => setCred({ ...cred, port: e.target.value })} />
                  <Button onClick={() => saveCred.mutate()} disabled={saveCred.isPending}>Guardar</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Puerto</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credentials.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.ip || <Badge variant="secondary">Global</Badge>}</TableCell>
                        <TableCell>{c.name || "—"}</TableCell>
                        <TableCell>{c.username}</TableCell>
                        <TableCell>{c.port || (c.protocol === "https" ? 443 : 80)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => delCred.mutate(c.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!credentials.length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin credenciales</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Perfiles ──────────────────────────────── */}
          <TabsContent value="perfiles">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Perfiles aprendidos por modelo</CardTitle>
                <CardDescription>Un perfil verificado se aplica automáticamente a todas las ONUs iguales.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Login</TableHead>
                      <TableHead>Usos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profiles.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.brand}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.login_type}</TableCell>
                        <TableCell>{p.times_used}</TableCell>
                        <TableCell>
                          {p.verified ? <Badge>Verificado</Badge> : <Badge variant="outline">Sin probar</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => delProfile.mutate(p.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!profiles.length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Aún no se ha aprendido ningún modelo</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Historial ─────────────────────────────── */}
          <TabsContent value="historial">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Últimos accesos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Evento</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Detalle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                        <TableCell>{e.ip}</TableCell>
                        <TableCell>
                          <Badge variant={e.event_type.includes("error") ? "destructive" : "secondary"}>{e.event_type}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{e.user_email || "—"}</TableCell>
                        <TableCell className="max-w-md truncate text-xs text-muted-foreground">{e.detail}</TableCell>
                      </TableRow>
                    ))}
                    {!events.length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin actividad</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
