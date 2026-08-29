import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { netAccessApi } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, RefreshCw, KeyRound, SignalHigh } from "lucide-react";

export interface ApTargetInfo {
  ip: string;
  brand: string;
  name?: string;
}

const QUALITY: Record<string, { label: string; className: string }> = {
  excelente: { label: "Excelente", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  buena: { label: "Buena", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  regular: { label: "Regular", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  mala: { label: "Mala", className: "bg-destructive/15 text-destructive border-destructive/30" },
  desconocida: { label: "Sin datos", className: "bg-muted text-muted-foreground" },
};

interface Props {
  mikrotikId: string;
  target: ApTargetInfo | null;
  onOpenChange: (open: boolean) => void;
}

export function ApSignalDialog({ mikrotikId, target, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [showCreds, setShowCreds] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", port: "", protocol: "http", brand: "otro" });

  const { data: saved } = useQuery({
    queryKey: ["ap-credentials"],
    queryFn: () => netAccessApi.listApCredentials(),
    enabled: !!target,
  });

  useEffect(() => {
    if (!target) return;
    const entry = (saved || []).find((c: any) => c.ip === target.ip);
    setForm({
      username: entry?.username || (target.brand === "ubiquiti" ? "ubnt" : "admin"),
      password: "",
      port: entry?.port ? String(entry.port) : "",
      protocol: entry?.protocol || (target.brand === "ubiquiti" ? "https" : "http"),
      brand: entry?.brand || target.brand || "otro",
    });
  }, [target, saved]);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["ap-clients", mikrotikId, target?.ip],
    queryFn: () => netAccessApi.apClients(mikrotikId, target!.ip, target!.brand),
    enabled: !!target && !!mikrotikId,
    retry: false,
    refetchInterval: 30_000,
  });

  const saveCreds = useMutation({
    mutationFn: () =>
      netAccessApi.saveApCredentials({
        ip: target!.ip,
        name: target?.name || null,
        brand: form.brand,
        username: form.username,
        password: form.password,
        port: form.port ? Number(form.port) : null,
        protocol: form.protocol,
      }),
    onSuccess: () => {
      toast.success("Credenciales guardadas");
      qc.invalidateQueries({ queryKey: ["ap-credentials"] });
      setShowCreds(false);
      refetch();
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar"),
  });

  const clients = data?.clients ?? [];

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SignalHigh className="w-4 h-4" /> Señal — {target?.name || target?.ip}
          </DialogTitle>
          <DialogDescription>
            Clientes wireless leídos directamente del AP {target?.ip} ({data?.protocol || form.protocol}:
            {data?.port || form.port || "auto"}).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Actualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowCreds((v) => !v)}>
            <KeyRound className="w-3.5 h-3.5 mr-1" /> Credenciales del AP
          </Button>
        </div>

        {showCreds && (
          <div className="grid gap-3 md:grid-cols-5 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Marca</Label>
              <Select value={form.brand} onValueChange={(v) => setForm({ ...form, brand: v })}>
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
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contraseña</Label>
              <Input type="password" placeholder="••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Puerto</Label>
              <Input type="number" placeholder="auto" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Protocolo</Label>
              <div className="flex gap-2">
                <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="https">HTTPS</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => saveCreds.mutate()} disabled={saveCreds.isPending}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive">
            {(error as any).message} — guarda usuario y contraseña del AP para poder leer su señal.
          </p>
        ) : isFetching && !clients.length ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Consultando el AP…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4">Cliente</th>
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
                {clients.map((c: any, i: number) => {
                  const q = QUALITY[c.quality] || QUALITY.desconocida;
                  return (
                    <tr key={c.mac || i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{c.name || "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{c.mac || "—"}</td>
                      <td className="py-2 pr-4 font-mono">{c.signal != null ? `${c.signal} dBm` : "—"}</td>
                      <td className="py-2 pr-4">{c.snr != null ? `${c.snr} dB` : "—"}</td>
                      <td className="py-2 pr-4">{c.ccq != null ? `${c.ccq}%` : "—"}</td>
                      <td className="py-2 pr-4 text-xs">{[c.tx_rate, c.rx_rate].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="py-2 pr-4 text-xs">{c.uptime || "—"}</td>
                      <td className="py-2">
                        <Badge variant="outline" className={q.className}>{q.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {!clients.length && !isFetching && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">El AP no reporta clientes wireless.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
