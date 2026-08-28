import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Copy, Download, RefreshCw, Router as RouterIcon, Satellite, ShieldCheck } from "lucide-react";

interface AcsInfo {
  tenant: { id: string; name: string; slug: string };
  vpn_subnet: string;
  token: string;
  public_url: string;
  vpn_url: string;
  acs_username: string;
  acs_password: string;
  connection_request_username: string;
  connection_request_password: string;
  inform_interval: number;
  stun_enable: boolean;
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
    ta.style.top = "0";
    ta.style.left = "0";
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


const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1.5">
    <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-sm" />
      <Button variant="outline" size="icon" onClick={() => copy(value)} aria-label={`Copiar ${label}`}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  </div>
);

const IspAcs = () => {
  const queryClient = useQueryClient();
  const [peerName, setPeerName] = useState("mikrotik-1");
  const [onuNetworks, setOnuNetworks] = useState("10.82.0.0/21");
  const [script, setScript] = useState<string>("");

  const { data: acs, isLoading } = useQuery({
    queryKey: ["isp-acs"],
    queryFn: async () => (await api<{ data: AcsInfo }>("/isp/acs")).data,
  });

  const { data: vpn } = useQuery({
    queryKey: ["isp-vpn"],
    queryFn: async () => (await api<{ data: any }>("/isp/vpn")).data,
  });

  const rotate = useMutation({
    mutationFn: () => api("/isp/acs/rotate", { method: "POST" }),
    onSuccess: () => {
      toast.success("Nuevo enlace TR-069 generado");
      queryClient.invalidateQueries({ queryKey: ["isp-acs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      api<{ data: { script: string } }>("/isp/vpn/script", {
        method: "POST",
        body: { name: peerName, onu_networks: onuNetworks },
      }),
    onSuccess: (res) => {
      setScript(res.data.script);
      queryClient.invalidateQueries({ queryKey: ["isp-vpn"] });
      toast.success("Script generado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Satellite className="h-6 w-6 text-primary" />
            TR-069 y VPN del ISP
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada ISP tiene su propio enlace TR-069 y su propio túnel. Las ONUs de un ISP no son visibles para otro.
          </p>
        </header>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Enlace TR-069 {acs ? `— ${acs.tenant.name}` : ""}
              </CardTitle>
              <CardDescription>
                Configura esta URL en las ONUs. Preferir la URL por VPN: aplica los cambios más rápido.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Rotar enlace
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {isLoading || !acs ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <>
                <Field label="ACS URL (por VPN — recomendada)" value={acs.vpn_url} />
                <Field label="ACS URL (pública)" value={acs.public_url} />
                <Field label="Usuario ACS" value={acs.acs_username} />
                <Field label="Clave ACS" value={acs.acs_password} />
                <Field label="Connection Request usuario" value={acs.connection_request_username} />
                <Field label="Connection Request clave" value={acs.connection_request_password} />
                <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-1">
                  <Badge className="bg-success text-success-foreground hover:bg-success">Token activo</Badge>
                  <code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                    {acs.token.slice(0, 6)}…{acs.token.slice(-4)}
                  </code>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(acs.token)} aria-label="Copiar token ACS">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Badge variant="secondary">Inform: {acs.inform_interval}s</Badge>
                  <Badge variant="secondary">STUN: desactivado (se usa la VPN)</Badge>
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
              Script para la MikroTik (VPN L2TP/IPsec)
            </CardTitle>
            <CardDescription>
              Genera el script completo: túnel L2TP/IPsec al VPS, firewall, acceso a la API y ruta hacia la red de
              administración de las ONUs. Pégalo tal cual en la terminal de RouterOS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Nombre del router</Label>
                <Input value={peerName} onChange={(e) => setPeerName(e.target.value)} placeholder="mikrotik-1" />
              </div>
              <div className="space-y-1.5">
                <Label>Red de administración de ONUs</Label>
                <Input value={onuNetworks} onChange={(e) => setOnuNetworks(e.target.value)} placeholder="10.82.0.0/21" />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={() => generate.mutate()} disabled={generate.isPending}>
                  {generate.isPending ? "Generando…" : "Generar script"}
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
                      <span className="font-mono text-xs text-code-muted">omnisync-{peerName || "mikrotik"}.rsc</span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-code-foreground hover:bg-code-header/60 hover:text-code-foreground" onClick={() => downloadScript(script, peerName)}>
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


            {!!vpn?.peers?.length && (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Routers conectados</Label>
                <div className="grid gap-2 md:grid-cols-2">
                  {vpn.peers.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-muted-foreground">{p.tunnel_ip}</span>
                      <Badge variant={p.is_active ? "default" : "secondary"}>
                        {p.is_active ? "activo" : "inactivo"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default IspAcs;
