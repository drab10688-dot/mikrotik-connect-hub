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
import { Globe, Wifi, KeyRound, Search, Save, Trash2, ShieldCheck, History, MonitorCog, Radio, Check } from "lucide-react";

/**
 * Acceso web directo a ONUs: el VPS entra por la VPN a la interfaz web de la ONU
 * y solo modifica WiFi y PPPoE. Lo aprendido de un modelo se reutiliza en los demás.
 */
export default function OnuWeb() {
  const qc = useQueryClient();
  const [ip, setIp] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [probeResult, setProbeResult] = useState<any>(null);
  const [profileName, setProfileName] = useState("");
  const [wifi, setWifi] = useState({ ssid: "", password: "" });
  const [pppoe, setPppoe] = useState({ username: "", password: "" });
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [cred, setCred] = useState({ ip: "", name: "", username: "admin", password: "", port: "", protocol: "http" });

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
    mutationFn: () => onuWebApi.probe({ ip, username: user || undefined, password: pass || undefined }),
    onSuccess: (data: any) => {
      setProbeResult(data);
      setSelectedProfile(data?.matched_profile?.id || "");
      setProfileName(data?.matched_profile?.name || `${data?.detected?.brand || "onu"} ${data?.detected?.model || ""}`.trim());
      toast.success(data?.matched_profile ? "Modelo reconocido: perfil existente aplicado" : "ONU detectada, revisa el perfil sugerido");
    },
    onError: (e: any) => toast.error(e.message || "No se pudo alcanzar la ONU"),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      onuWebApi.createProfile({
        name: profileName,
        ...probeResult?.suggestion,
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
            <Globe className="h-6 w-6 text-primary" /> Acceso web a ONUs
          </h1>
          <p className="text-sm text-muted-foreground">
            Entra por la VPN a la web de la ONU y cambia solo WiFi y PPPoE. Sin TR-069.
            Cada modelo se aprende una vez y el perfil se reutiliza para las demás.
          </p>
        </header>

        <Tabs defaultValue="gestion">
          <TabsList>
            <TabsTrigger value="gestion">Gestionar ONU</TabsTrigger>
            <TabsTrigger value="credenciales">Credenciales</TabsTrigger>
            <TabsTrigger value="perfiles">Perfiles aprendidos</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>

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
                    <Button className="w-full" disabled={!ip || probe.isPending} onClick={() => probe.mutate()}>
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
