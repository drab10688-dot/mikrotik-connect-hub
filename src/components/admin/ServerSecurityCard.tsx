import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { securityApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Unlock } from "lucide-react";

/** fail2ban para SSH: bloquea las IPs que fallan la contraseña varias veces. */
export function ServerSecurityCard() {
  const qc = useQueryClient();
  const [adminIps, setAdminIps] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["security-fail2ban"],
    queryFn: () => securityApi.fail2ban(),
    // Mientras se instala/desinstala, consulta cada 3 s
    refetchInterval: (q) => ((q.state.data as any)?.job?.running ? 3000 : false),
  });

  useEffect(() => {
    if (data && !loaded) {
      setAdminIps((data.admin_ips || []).join(" "));
      setLoaded(true);
    }
  }, [data, loaded]);

  useEffect(() => {
    if (data?.job && !data.job.running && data.job.finishedAt) {
      if (data.job.error) toast.error(`fail2ban: ${data.job.error}`);
    }
  }, [data?.job?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useMutation({
    mutationFn: (enabled: boolean) => securityApi.setFail2ban(enabled, adminIps),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? "Activando fail2ban… (puede tardar 1-2 min)" : "Desactivando fail2ban…");
      qc.invalidateQueries({ queryKey: ["security-fail2ban"] });
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo aplicar"),
  });

  const unban = useMutation({
    mutationFn: (ip: string) => securityApi.unban(ip),
    onSuccess: () => { toast.success("IP desbloqueada"); qc.invalidateQueries({ queryKey: ["security-fail2ban"] }); },
    onError: (e: any) => toast.error(e?.message || "No se pudo desbloquear"),
  });

  const running = Boolean(data?.job?.running) || apply.isPending;
  const addMyIp = () => {
    const ip = data?.client_ip;
    if (!ip) return;
    const list = adminIps.split(/[\s,;]+/).filter(Boolean);
    if (!list.includes(ip)) setAdminIps([...list, ip].join(" "));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><ShieldCheck className="h-6 w-6 text-emerald-500" /></div>
            <div>
              <CardTitle className="text-lg">Seguridad del servidor (SSH)</CardTitle>
              <CardDescription>
                fail2ban bloquea 1 hora la IP que falla la contraseña SSH 5 veces en 10 minutos.
                Quien entra con llave SSH no se ve afectado.
              </CardDescription>
            </div>
          </div>
          {data && (
            <Badge variant={data.active ? "default" : "secondary"}>
              {running ? "Aplicando…" : data.active ? "Activo" : data.installed ? "Desactivado" : "No instalado"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground"><Loader2 className="inline mr-2 h-4 w-4 animate-spin" />Consultando el servidor…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as any)?.message || "No se pudo consultar el servidor"}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(data?.active)}
                disabled={running}
                onCheckedChange={(v) => apply.mutate(v)}
              />
              <Label>Proteger SSH con fail2ban</Label>
              {running && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-1">
              <Label>IPs que nunca se bloquean (además de la VPN {data?.vpn_net})</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="flex-1 min-w-[220px]"
                  placeholder="Ej: 181.50.10.20 190.0.0.0/24"
                  value={adminIps}
                  onChange={(e) => setAdminIps(e.target.value)}
                />
                {data?.client_ip && (
                  <Button variant="outline" onClick={addMyIp}>Agregar mi IP ({data.client_ip})</Button>
                )}
                {data?.active && (
                  <Button onClick={() => apply.mutate(true)} disabled={running}>Guardar IPs</Button>
                )}
              </div>
            </div>

            {data?.active && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Bloqueadas ahora: <b>{data.banned_now}</b> · Total bloqueadas: <b>{data.banned_total}</b> ·
                  Intentos fallidos: <b>{data.failed_total}</b>
                </p>
                {Boolean(data.banned_list?.length) && (
                  <div className="flex flex-wrap gap-2">
                    {data.banned_list.slice(0, 50).map((ip: string) => (
                      <Badge key={ip} variant="outline" className="gap-1">
                        {ip}
                        <button
                          type="button"
                          title="Desbloquear"
                          className="ml-1 opacity-70 hover:opacity-100"
                          onClick={() => unban.mutate(ip)}
                        >
                          <Unlock className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {data.banned_list.length > 50 && (
                      <span className="text-xs text-muted-foreground">y {data.banned_list.length - 50} más</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
