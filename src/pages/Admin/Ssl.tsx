import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sslApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Globe, Loader2, ShieldCheck, RefreshCw } from "lucide-react";

/** Dominio propio + certificado HTTPS gratuito (Let's Encrypt) del panel. */
export default function SslSettings() {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["ssl-settings"],
    queryFn: () => sslApi.get(),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (data) {
      setDomain((d) => d || data.domain || "");
      setEmail((e) => e || data.email || "");
    }
  }, [data]);

  const check = useMutation({
    mutationFn: () => sslApi.check(domain.trim()),
    onSuccess: (r: any) =>
      r?.ok
        ? toast.success(`El dominio apunta correctamente a ${r.expected || r.resolved?.[0]}`)
        : toast.warning(
            r?.resolved?.length
              ? `El dominio resuelve a ${r.resolved.join(", ")} y debería apuntar a ${r.expected || "la IP del VPS"}`
              : "El dominio aún no resuelve. Cree el registro A y espere la propagación."
          ),
    onError: (e: any) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: () => sslApi.issue(domain.trim(), email.trim()),
    onSuccess: () => {
      toast.success("Certificado emitido. Ingrese por https://" + domain.trim());
      queryClient.invalidateQueries({ queryKey: ["ssl-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const expires = data?.certificate_expires_at
    ? new Date(data.certificate_expires_at).toLocaleDateString()
    : null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 md:ml-64 space-y-6 overflow-x-hidden">
        <header className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Dominio y certificado HTTPS</h1>
            <p className="text-sm text-muted-foreground">
              Conecte su dominio propio y active el candado seguro sin usar la consola.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5" /> Estado actual
            </CardTitle>
            <CardDescription>
              Apunte un registro <b>A</b> de su dominio a la IP{" "}
              <b>{data?.public_ip || "pública del VPS"}</b> antes de emitir el certificado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Certificado:</span>
                  {data?.has_certificate ? (
                    <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                      Activo hasta {expires}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Sin certificado</Badge>
                  )}
                  {data?.domain && <Badge variant="outline">{data.domain}</Badge>}
                </div>
                {data?.dns && (
                  <p className="text-muted-foreground">
                    DNS: {data.dns.resolved?.length ? data.dns.resolved.join(", ") : "sin resolver"}
                    {data.dns.expected ? ` (esperado ${data.dns.expected})` : ""}
                  </p>
                )}
                {data?.last_message && <p className="text-muted-foreground">{data.last_message}</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configurar dominio</CardTitle>
            <CardDescription>
              La renovación es automática: el sistema revisa el certificado a diario.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Dominio</Label>
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="panel.midominio.com"
                  autoCapitalize="none"
                />
              </div>
              <div className="space-y-2">
                <Label>Correo de avisos (opcional)</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="soporte@midominio.com"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => check.mutate()}
                disabled={!domain.trim() || check.isPending}
              >
                {check.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Verificar DNS
              </Button>
              <Button onClick={() => issue.mutate()} disabled={!domain.trim() || issue.isPending}>
                {issue.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                {data?.has_certificate ? "Renovar ahora" : "Emitir certificado"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Puede tardar hasta un minuto. Al terminar, ingrese siempre por https://{domain || "sudominio"} —
              el escritorio remoto (puerto 8081) usará el mismo certificado.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
