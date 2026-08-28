import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Copy, Download, RefreshCw, Router as RouterIcon, Satellite, ShieldCheck, Trash2 } from "lucide-react";

interface AcsInfo {
  tenant: { id: string; name: string; slug: string };
  vpn_subnet: string;
  token: string;
  public_url: string;
  nat_url: string;
  vpn_url: string;
  acs_username: string;
  acs_password: string;
  connection_request_username: string;
  connection_request_password: string;
  inform_interval: number;
  stun_enable: boolean;
  stun_host: string;
  stun_port: number;
  stun_username: string;
  stun_password: string;
}

/** Copia robusta: funciona también dentro de iframes y sin HTTPS. */
const copyText = async (value: string) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      toast.success("Copiado");
      return;
    }
  } catch {
    /* se usa el respaldo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const okCopy = document.execCommand("copy");
    document.body.removeChild(ta);
    if (okCopy) toast.success("Copiado");
    else toast.error("No se pudo copiar: selecciona el texto y usa Ctrl+C");
  } catch {
    toast.error("No se pudo copiar: selecciona el texto y usa Ctrl+C");
  }
};

const copy = (value: string) => {
  void copyText(value);
};

const downloadScript = (value: string, name: string) => {
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `omnisync-${name || "mikrotik"}.rsc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const Field = ({
  label,
  value,
  editable = false,
  onChange,
}: {
  label: string;
  value: string;
  editable?: boolean;
  onChange?: (v: string) => void;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
    <div className="flex gap-2">
      <Input
        readOnly={!editable}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="font-mono text-sm"
      />
      {!editable && (
        <Button variant="outline" size="icon" onClick={() => copy(value)} aria-label={`Copiar ${label}`}>
          <Copy className="h-4 w-4" />
        </Button>
      )}
    </div>
  </div>
);

const IspAcs = () => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"vpn" | "nat">("vpn");
  const [peerName, setPeerName] = useState("mikrotik-1");
  const [onuNetworks, setOnuNetworks] = useState("10.82.0.0/21");
  const [script, setScript] = useState<string>("");
  const { data: acs, isLoading, error: acsError, refetch: refetchAcs } = useQuery({
    queryKey: ["isp-acs"],
    queryFn: async () => (await api<{ data: AcsInfo }>("/isp/acs")).data,
    retry: 1,
  });

  const { data: vpn } = useQuery({
    queryKey: ["isp-vpn"],
    queryFn: async () => (await api<{ data: any }>("/isp/vpn")).data,
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    if (!acs) return;
    setForm({
      acs_username: acs.acs_username || "",
      acs_password: acs.acs_password || "",
      connection_request_username: acs.connection_request_username || "",
      connection_request_password: acs.connection_request_password || "",
      stun_host: acs.stun_host || "",
      stun_port: String(acs.stun_port ?? ""),
      stun_username: acs.stun_username || "",
      stun_password: acs.stun_password || "",
      inform_interval: String(acs.inform_interval ?? ""),
    });
    setEditing(true);
  };

  const saveCreds = useMutation({
    mutationFn: () => api("/isp/acs/credentials", { method: "PUT", body: form }),
    onSuccess: () => {
      toast.success("Credenciales actualizadas");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["isp-acs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      api<{ data: { script: string } }>("/isp/vpn/script", {
        method: "POST",
        body: { name: peerName, onu_networks: onuNetworks, mode },
      }),
    onSuccess: (res) => {
      setScript(res.data.script);
      queryClient.invalidateQueries({ queryKey: ["isp-vpn"] });
      toast.success(mode === "vpn" ? "VPN generada" : "Configuración sin VPN generada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removePeer = useMutation({
    mutationFn: (id: string) => api(`/isp/vpn/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("VPN eliminada");
      queryClient.invalidateQueries({ queryKey: ["isp-vpn"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto p-4 md:p-6 md:ml-64 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Satellite className="h-6 w-6 text-primary" />
            Credenciales TR-069, STUN y VPN
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos los datos para conectar las ONUs al ACS: URL, usuario, clave, STUN y túnel L2TP.
          </p>
        </header>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Enlace TR-069
              </CardTitle>
              <CardDescription>
                Con VPN usa la URL del túnel; sin VPN (ONU tras NAT) usa la URL pública con STUN.
              </CardDescription>
            </div>
            {acs && (
              editing ? (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEditing(false)} disabled={saveCreds.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={() => saveCreds.mutate()} disabled={saveCreds.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    {saveCreds.isPending ? "Guardando…" : "Guardar"}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={startEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar credenciales
                </Button>
              )
            )}
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : !acs ? (
              <div className="md:col-span-2 space-y-2">
                <p className="text-sm text-destructive">
                  No se pudo obtener el enlace TR-069{(acsError as any)?.message ? `: ${(acsError as any).message}` : ""}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetchAcs()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reintentar
                </Button>
              </div>
            ) : (
              <>
                <Field label="ACS URL (por VPN)" value={acs.vpn_url} />
                <Field label="ACS URL (sin VPN — tras NAT)" value={acs.nat_url} />
                <Field label="Usuario ACS" value={acs.acs_username} />
                <Field label="Clave ACS" value={acs.acs_password} />
                <Field label="Connection Request usuario" value={acs.connection_request_username} />
                <Field label="Connection Request clave" value={acs.connection_request_password} />
                <Field label="Servidor STUN (sin VPN)" value={`${acs.stun_host}:${acs.stun_port}`} />
                <Field label="STUN usuario / clave" value={`${acs.stun_username} / ${acs.stun_password}`} />
                <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-1">
                  <Badge className="bg-success text-success-foreground hover:bg-success">Token activo</Badge>
                  <code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                    {acs.token.slice(0, 6)}…{acs.token.slice(-4)}
                  </code>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(acs.token)} aria-label="Copiar token ACS">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Badge variant="secondary">Inform: {acs.inform_interval}s</Badge>
                  <Badge variant="secondary">Subred VPN: {acs.vpn_subnet}</Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RouterIcon className="h-5 w-5 text-primary" />
              Conexión de las ONUs
            </CardTitle>
            <CardDescription>
              Elige cómo se conectan las ONUs: por túnel L2TP hacia el VPS, o directo tras NAT con STUN.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => { setMode(v as "vpn" | "nat"); setScript(""); }}>
              <TabsList>
                <TabsTrigger value="vpn">Con VPN L2TP</TabsTrigger>
                <TabsTrigger value="nat">Sin VPN (tras NAT)</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-4 md:grid-cols-3">
              {mode === "vpn" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Nombre del router</Label>
                    <Input value={peerName} onChange={(e) => setPeerName(e.target.value)} placeholder="mikrotik-1" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Red de administración de ONUs</Label>
                    <Input value={onuNetworks} onChange={(e) => setOnuNetworks(e.target.value)} placeholder="10.82.0.0/21" />
                  </div>
                </>
              )}
              <div className="flex items-end">
                <Button className="w-full" onClick={() => generate.mutate()} disabled={generate.isPending}>
                  {generate.isPending ? "Generando…" : mode === "vpn" ? "Generar VPN + script" : "Generar configuración"}
                </Button>
              </div>
            </div>

            {script && (
              <>
                <Separator />
                <div className="overflow-hidden rounded-lg border border-code-border bg-code shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-code-border bg-code-header px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex gap-1.5" aria-hidden>
                        <i className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
                        <i className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                        <i className="h-2.5 w-2.5 rounded-full bg-success/80" />
                      </span>
                      <span className="font-mono text-xs text-code-muted">
                        omnisync-{mode === "vpn" ? peerName || "mikrotik" : "sin-vpn"}.rsc
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-code-foreground hover:bg-code-header/60 hover:text-code-foreground"
                        onClick={() => downloadScript(script, mode === "vpn" ? peerName : "sin-vpn")}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" /> Descargar .rsc
                      </Button>
                      <Button size="sm" className="h-7" onClick={() => copy(script)}>
                        <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar script
                      </Button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={script}
                    onFocus={(e) => e.currentTarget.select()}
                    spellCheck={false}
                    className="h-96 w-full resize-y bg-code p-4 text-xs font-mono leading-relaxed text-code-foreground outline-none"
                    aria-label="Script para la MikroTik"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Si el botón no copia (navegador restringido), haz clic dentro del recuadro y usa Ctrl+C.
                </p>
              </>
            )}

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">VPNs L2TP creadas</Label>
              {!vpn?.peers?.length ? (
                <p className="text-sm text-muted-foreground">Todavía no hay túneles L2TP creados.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {vpn.peers.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-muted-foreground truncate">
                          {p.username} · {p.tunnel_ip}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "activo" : "inactivo"}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removePeer.mutate(p.id)}
                          disabled={removePeer.isPending}
                          aria-label={`Eliminar VPN ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default IspAcs;
