import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, Trash2 } from "lucide-react";

interface Block {
  id: number;
  oui: string;
  product_class: string;
  firmware: string;
  param: string;
  kind: "read" | "write";
  fault_code: string | null;
  hits: number;
  last_seen: string;
}

interface Pending {
  deviceId: string;
  code: string | null;
  message: string;
  param: string | null;
  retries: number | null;
  timestamp: string | null;
  model: string | null;
  manufacturer: string | null;
  serial: string | null;
  firmware: string | null;
  pppoe: string | null;
}

interface Health {
  canManage: boolean;
  blocks: Block[];
  pending: Pending[];
}

function when(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

// Último tramo de la ruta TR-069, que es lo que identifica el dato.
function shortParam(p: string | null) {
  if (!p) return "—";
  const parts = p.split(".");
  return parts.slice(-2).join(".");
}

/**
 * Aviso "Lectura TR-069": parámetros que un modelo/firmware no sabe leer o
 * escribir (el sistema los aparta solo y reintenta) y tareas que siguen
 * fallando. Se oculta si no hay nada que mostrar.
 */
export default function AcsReadHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api("/genieacs/read-health");
      setHealth(res?.data ?? null);
    } catch {
      /* opcional */
    }
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60000);
    return () => window.clearInterval(t);
  }, [load]);

  const forget = async (id: number) => {
    setBusy(id);
    try {
      const res = await api(`/genieacs/read-health/blocks/${id}`, { method: "DELETE" });
      toast.success(res?.message || "Regla eliminada");
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (!health || (!health.blocks.length && !health.pending.length)) return null;
  const { blocks, pending, canManage } = health;

  return (
    <Card className={pending.length ? "border-amber-500/50" : undefined}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left"
        >
          {pending.length
            ? <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            : <ShieldCheck className="w-5 h-5 text-primary shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium">Lectura TR-069</p>
            <p className="text-sm text-muted-foreground">
              {pending.length
                ? "Hay ONUs con lectura o cambios incompletos."
                : "Parámetros rotos de algunos firmwares se apartan solos; la lectura sigue funcionando."}
            </p>
          </div>
          {pending.length > 0 && <Badge variant="destructive">{pending.length} con error</Badge>}
          {blocks.length > 0 && <Badge variant="secondary">{blocks.length} aprendidos</Badge>}
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {open && (
          <div className="border-t px-4 py-4 space-y-5">
            {pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Tareas con error</p>
                <p className="text-xs text-muted-foreground">
                  Los errores de lectura se resuelven solos en uno o dos minutos. Lo que quede aquí
                  necesita revisión (ONU sin conexión o un valor que la ONU rechaza).
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ONU</TableHead>
                        <TableHead>Modelo / firmware</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Reintentos</TableHead>
                        <TableHead>Fecha</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.map((p) => (
                        <TableRow key={`${p.deviceId}-${p.timestamp}-${p.param}`}>
                          <TableCell className="whitespace-nowrap">{p.pppoe || p.serial || p.deviceId}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {[p.manufacturer, p.model].filter(Boolean).join(" ") || "—"}
                            <span className="block text-xs text-muted-foreground">{p.firmware || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">{p.code || "—"}</span>
                            <span className="block text-xs text-muted-foreground break-all">
                              {p.param ? shortParam(p.param) : p.message || "—"}
                            </span>
                          </TableCell>
                          <TableCell>{p.retries ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{when(p.timestamp)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {blocks.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Parámetros apartados por modelo</p>
                <p className="text-xs text-muted-foreground">
                  Estos datos fallan en ese firmware y ya no se piden. Si actualiza el firmware del lote,
                  puede borrar la regla para que se vuelva a probar.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Modelo / firmware</TableHead>
                        <TableHead>Parámetro</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Veces</TableHead>
                        <TableHead>Último</TableHead>
                        {canManage && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blocks.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="whitespace-nowrap">
                            {b.product_class}
                            <span className="block text-xs text-muted-foreground">{b.firmware || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs" title={b.param}>{shortParam(b.param)}</span>
                            <span className="block text-xs text-muted-foreground">{b.fault_code || ""}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{b.kind === "read" ? "Lectura" : "Escritura"}</Badge>
                          </TableCell>
                          <TableCell>{b.hits}</TableCell>
                          <TableCell className="whitespace-nowrap">{when(b.last_seen)}</TableCell>
                          {canManage && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy === b.id}
                                onClick={() => forget(b.id)}
                                title="Borrar regla"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
