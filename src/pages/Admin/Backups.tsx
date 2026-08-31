import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backupApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Database, HardDriveDownload, Loader2, Trash2, Building2, Server } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const formatSize = (bytes: number) => {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

/** Copias de seguridad: por ISP (datos de la empresa) y del sistema completo. */
export default function Backups() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: () => backupApi.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["backups"] });

  const runTenant = useMutation({
    mutationFn: () => backupApi.runTenant(),
    onSuccess: (d: any) => { toast.success(`Copia del ISP creada (${formatSize(d?.size_bytes || 0)})`); refresh(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo crear la copia"),
  });

  const runSystem = useMutation({
    mutationFn: () => backupApi.runSystem(),
    onSuccess: (d: any) => { toast.success(`Copia total creada (${formatSize(d?.size_bytes || 0)})`); refresh(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo crear la copia del sistema"),
  });

  const remove = useMutation({
    mutationFn: (filename: string) => backupApi.remove(filename),
    onSuccess: () => { toast.success("Copia eliminada"); refresh(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo eliminar"),
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Copias de seguridad</h1>
            <p className="text-muted-foreground">Respalda los datos de tu ISP o toda la plataforma</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10"><Building2 className="h-6 w-6 text-primary" /></div>
                  <div>
                    <CardTitle className="text-lg">Copia del ISP</CardTitle>
                    <CardDescription>Clientes, equipos, usuarios y permisos de tu empresa</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => runTenant.mutate()} disabled={runTenant.isPending} className="w-full">
                  {runTenant.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                  Generar copia del ISP
                </Button>
              </CardContent>
            </Card>

            {isSuperAdmin && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-accent/10"><Server className="h-6 w-6 text-accent" /></div>
                    <div>
                      <CardTitle className="text-lg">Copia total del sistema</CardTitle>
                      <CardDescription>Volcado completo de la base de datos</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={() => runSystem.mutate()} disabled={runSystem.isPending} className="w-full">
                    {runSystem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
                    Generar copia total
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Historial</CardTitle>
              <CardDescription>Últimas copias disponibles en el servidor</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                <p className="py-6 text-center text-muted-foreground">Cargando…</p>
              ) : !jobs?.length ? (
                <p className="py-6 text-center text-muted-foreground">Todavía no hay copias generadas</p>
              ) : (
                jobs.map((job: any) => (
                  <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString("es-CO")} · {formatSize(Number(job.size_bytes))}
                        {job.tenant_name ? ` · ${job.tenant_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={job.scope === "system" ? "default" : "secondary"}>
                        {job.scope === "system" ? "Sistema" : "ISP"}
                      </Badge>
                      {job.status !== "ok" && <Badge variant="destructive">Error</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!job.available}
                        asChild={job.available}
                      >
                        {job.available ? (
                          <a href={backupApi.downloadUrl(job.filename)} download>
                            <HardDriveDownload className="mr-2 h-4 w-4" />Descargar
                          </a>
                        ) : (
                          <span><HardDriveDownload className="mr-2 h-4 w-4" />No disponible</span>
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(job.filename)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
