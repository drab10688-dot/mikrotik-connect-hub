import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backupApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Database, HardDriveDownload, Loader2, Trash2, Building2, Server,
  RotateCcw, Upload, Cloud, CloudDownload, CloudUpload, PlugZap,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const formatSize = (bytes: number) => {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

/** Copias de seguridad: generar, restaurar y sincronizar con Dropbox. */
export default function Backups() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [dropbox, setDropbox] = useState<any>(null);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: () => backupApi.list(),
  });

  const { data: settings } = useQuery({
    queryKey: ["backup-settings"],
    queryFn: async () => {
      const s = await backupApi.getSettings();
      setDropbox({ ...s, dropbox_app_secret: "", dropbox_refresh_token: "" });
      return s;
    },
  });

  const { data: remoteFiles } = useQuery({
    queryKey: ["backup-remote"],
    queryFn: () => backupApi.remoteList(),
    enabled: Boolean(settings?.dropbox_enabled),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["backups"] });
    queryClient.invalidateQueries({ queryKey: ["backup-remote"] });
  };

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

  const restore = useMutation({
    mutationFn: (filename: string) => backupApi.restore(filename),
    onSuccess: (d: any) => {
      toast.success(d?.scope === "system" ? "Sistema restaurado" : "Datos del ISP restaurados");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo restaurar"),
  });

  const restoreUpload = useMutation({
    mutationFn: (file: File) => backupApi.restoreUpload(file),
    onSuccess: (d: any) => {
      toast.success(d?.scope === "system" ? "Sistema restaurado desde el archivo" : "ISP restaurado desde el archivo");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo restaurar el archivo"),
  });

  const push = useMutation({
    mutationFn: (filename: string) => backupApi.pushRemote(filename),
    onSuccess: () => { toast.success("Copia enviada a Dropbox"); refresh(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo subir a Dropbox"),
  });

  const pull = useMutation({
    mutationFn: (filename: string) => backupApi.pullRemote(filename),
    onSuccess: () => { toast.success("Copia descargada de Dropbox al servidor"); refresh(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo descargar de Dropbox"),
  });

  const saveSettings = useMutation({
    mutationFn: (s: any) => backupApi.saveSettings(s),
    onSuccess: () => {
      toast.success("Configuración de Dropbox guardada");
      queryClient.invalidateQueries({ queryKey: ["backup-settings"] });
      queryClient.invalidateQueries({ queryKey: ["backup-remote"] });
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo guardar"),
  });

  const testDropbox = useMutation({
    mutationFn: () => backupApi.testSettings(),
    onSuccess: (d: any) => toast.success(`Conectado a Dropbox: ${d?.account} (${d?.folder})`),
    onError: (e: any) => toast.error(e?.message || "No se pudo conectar con Dropbox"),
  });

  const busy = restore.isPending || restoreUpload.isPending;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Copias de seguridad</h1>
            <p className="text-muted-foreground">Respalda, restaura y guarda tus copias en Dropbox</p>
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

          {/* Restaurar desde archivo */}
          <Card className="border-amber-500/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10"><RotateCcw className="h-6 w-6 text-amber-500" /></div>
                <div>
                  <CardTitle className="text-lg">Restaurar desde un archivo</CardTitle>
                  <CardDescription>
                    Sube un archivo <code>.json.gz</code> (copia de ISP) o <code>.sql.gz</code> (sistema completo)
                    para recuperar la plataforma después de un daño.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".gz,.json,.sql"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPendingUpload(f);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                {restoreUpload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Seleccionar archivo y restaurar
              </Button>
              <p className="text-xs text-muted-foreground">
                La restauración sobrescribe los datos actuales. Genera una copia antes por seguridad.
              </p>
            </CardContent>
          </Card>

          {/* Dropbox */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10"><Cloud className="h-6 w-6 text-sky-500" /></div>
                <div>
                  <CardTitle className="text-lg">Enviar copias a Dropbox</CardTitle>
                  <CardDescription>
                    Crea una app en dropbox.com/developers, genera el <b>App key</b>, <b>App secret</b> y un
                    <b> refresh token</b> con permiso <code>files.content.write</code>.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={Boolean(dropbox?.dropbox_enabled)}
                    onCheckedChange={(v) => setDropbox((d: any) => ({ ...d, dropbox_enabled: v }))}
                  />
                  <Label>Activar Dropbox</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={dropbox?.auto_upload !== false}
                    onCheckedChange={(v) => setDropbox((d: any) => ({ ...d, auto_upload: v }))}
                  />
                  <Label>Subir automáticamente cada copia</Label>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>App key</Label>
                  <Input
                    value={dropbox?.dropbox_app_key || ""}
                    onChange={(e) => setDropbox((d: any) => ({ ...d, dropbox_app_key: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>App secret {settings?.has_secret && <span className="text-xs text-muted-foreground">(guardado)</span>}</Label>
                  <Input
                    type="password"
                    placeholder={settings?.has_secret ? "•••••• (dejar vacío para conservar)" : ""}
                    value={dropbox?.dropbox_app_secret || ""}
                    onChange={(e) => setDropbox((d: any) => ({ ...d, dropbox_app_secret: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Refresh token {settings?.has_refresh_token && <span className="text-xs text-muted-foreground">(guardado)</span>}</Label>
                  <Input
                    type="password"
                    placeholder={settings?.has_refresh_token ? "•••••• (dejar vacío para conservar)" : ""}
                    value={dropbox?.dropbox_refresh_token || ""}
                    onChange={(e) => setDropbox((d: any) => ({ ...d, dropbox_refresh_token: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Carpeta en Dropbox</Label>
                  <Input
                    value={dropbox?.dropbox_folder || "/OmniSync"}
                    onChange={(e) => setDropbox((d: any) => ({ ...d, dropbox_folder: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Copias a conservar en la nube</Label>
                  <Input
                    type="number"
                    min={1}
                    value={dropbox?.keep_remote ?? 10}
                    onChange={(e) => setDropbox((d: any) => ({ ...d, keep_remote: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => saveSettings.mutate(dropbox)} disabled={saveSettings.isPending}>
                  {saveSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar
                </Button>
                <Button variant="outline" onClick={() => testDropbox.mutate()} disabled={testDropbox.isPending}>
                  {testDropbox.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                  Probar conexión
                </Button>
              </div>

              {Boolean(remoteFiles?.length) && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium">Copias en Dropbox</p>
                  {remoteFiles!.map((f: any) => (
                    <div key={f.name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(f.modified).toLocaleString("es-CO")} · {formatSize(Number(f.size))}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => pull.mutate(f.name)} disabled={pull.isPending}>
                        <CloudDownload className="mr-2 h-4 w-4" />Traer al servidor
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

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
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={job.scope === "system" ? "default" : "secondary"}>
                        {job.scope === "system" ? "Sistema" : "ISP"}
                      </Badge>
                      {job.remote_path && <Badge variant="outline" className="gap-1"><Cloud className="h-3 w-3" />Dropbox</Badge>}
                      {job.status !== "ok" && <Badge variant="destructive">Error</Badge>}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || (!job.available && !job.remote_path)}
                        onClick={() => setConfirmFile(job.filename)}
                      >
                        {restore.isPending && restore.variables === job.filename
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <RotateCcw className="mr-2 h-4 w-4" />}
                        Restaurar
                      </Button>
                      {settings?.dropbox_enabled && job.available && !job.remote_path && (
                        <Button size="sm" variant="ghost" onClick={() => push.mutate(job.filename)} disabled={push.isPending}>
                          <CloudUpload className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={!job.available} asChild={job.available}>
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

      {/* Confirmación de restauración desde el servidor */}
      <AlertDialog open={Boolean(confirmFile)} onOpenChange={(o) => !o && setConfirmFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar esta copia?</AlertDialogTitle>
            <AlertDialogDescription>
              Los datos actuales serán reemplazados por los de <b>{confirmFile}</b>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmFile) restore.mutate(confirmFile); setConfirmFile(null); }}
            >
              Sí, restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación de restauración desde archivo subido */}
      <AlertDialog open={Boolean(pendingUpload)} onOpenChange={(o) => !o && setPendingUpload(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar desde el archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se restaurará <b>{pendingUpload?.name}</b> ({formatSize(pendingUpload?.size || 0)}) y se
              sobrescribirán los datos actuales.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingUpload) restoreUpload.mutate(pendingUpload); setPendingUpload(null); }}
            >
              Sí, restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
