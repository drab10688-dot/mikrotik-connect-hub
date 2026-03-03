import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  HardDrive, Download, Upload, Loader2, Trash2, Database,
  Server, Settings, Package, AlertTriangle, CheckCircle, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { backupApi, getToken } from "@/lib/api-client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";

interface BackupFile {
  name: string;
  size: number;
  sizeFormatted: string;
  created: string;
  type: string;
}

interface DiskInfo {
  total: string;
  used: string;
  available: string;
  percent: string;
}

interface DockerService {
  Name: string;
  State: string;
  Status: string;
  Service: string;
}

export function VpsBackupManager() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [services, setServices] = useState<DockerService[]>([]);
  const [backupType, setBackupType] = useState("full");
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const result = await backupApi.list();
      if (result.success) {
        setBackups(result.data.backups || []);
        setDisk(result.data.disk || null);
        setServices(result.data.services || []);
      }
    } catch (error: any) {
      if (error.status !== 401) {
        toast.error("No se pudo conectar al servidor VPS");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadBackups(); }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const result = await backupApi.create(backupType);
      if (result.success) {
        toast.success(`Backup creado: ${result.data.name} (${result.data.sizeFormatted})`);
        loadBackups();
      }
    } catch (error: any) {
      toast.error(error.message || "Error al crear backup");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setIsRestoring(filename);
    try {
      const result = await backupApi.restore(filename);
      if (result.success) {
        toast.success("Backup restaurado correctamente");
      }
    } catch (error: any) {
      toast.error(error.message || "Error al restaurar");
    } finally {
      setIsRestoring(null);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await backupApi.delete(filename);
      toast.success("Backup eliminado");
      loadBackups();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar");
    }
  };

  const handleDownload = (filename: string) => {
    const url = backupApi.downloadUrl(filename);
    const token = getToken();
    // Open download with auth header via fetch
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error("Error al descargar"));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await backupApi.upload(file);
      toast.success(`Backup subido: ${result.data?.name || file.name}`);
      loadBackups();
    } catch (error: any) {
      toast.error(error.message || "Error al subir backup");
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const diskPercent = disk ? parseInt(disk.percent.replace('%', '')) : 0;

  const typeIcon = (type: string) => {
    switch (type) {
      case 'database': return <Database className="h-4 w-4" />;
      case 'docker': return <Package className="h-4 w-4" />;
      case 'config': return <Settings className="h-4 w-4" />;
      default: return <HardDrive className="h-4 w-4" />;
    }
  };

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      database: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
      docker: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
      config: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
      full: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    };
    const labels: Record<string, string> = {
      database: "Base de datos",
      docker: "Imágenes Docker",
      config: "Configuración",
      full: "Completo",
    };
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors[type] || colors.full}`}>{typeIcon(type)} {labels[type] || type}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Server Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <HardDrive className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Disco</p>
                {disk ? (
                  <>
                    <p className="text-lg font-bold">{disk.used} / {disk.total}</p>
                    <Progress value={diskPercent} className="mt-1 h-2" />
                    <p className="text-xs text-muted-foreground mt-1">{disk.available} disponible</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin datos</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Servicios Docker</p>
                <p className="text-lg font-bold">{services.length} contenedores</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {services.slice(0, 4).map((s, i) => (
                    <Badge key={i} variant={s.State === 'running' ? 'default' : 'destructive'} className="text-[10px]">
                      {s.Service || s.Name}
                    </Badge>
                  ))}
                  {services.length > 4 && <Badge variant="outline" className="text-[10px]">+{services.length - 4}</Badge>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Backups guardados</p>
                <p className="text-lg font-bold">{backups.length}</p>
                <p className="text-xs text-muted-foreground">
                  {backups.reduce((acc, b) => acc + b.size, 0) > 0
                    ? `${(backups.reduce((acc, b) => acc + b.size, 0) / 1024 / 1024).toFixed(1)} MB total`
                    : 'Sin backups'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Crear Backup del Servidor
          </CardTitle>
          <CardDescription>
            Crea un backup de las imágenes Docker, base de datos o configuración del VPS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={backupType} onValueChange={setBackupType}>
              <SelectTrigger className="sm:w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">
                  <span className="flex items-center gap-2"><HardDrive className="h-4 w-4" /> Completo (DB + Config)</span>
                </SelectItem>
                <SelectItem value="database">
                  <span className="flex items-center gap-2"><Database className="h-4 w-4" /> Solo Base de Datos</span>
                </SelectItem>
                <SelectItem value="config">
                  <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> Solo Configuración</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreate} disabled={isCreating} className="sm:flex-1">
              {isCreating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creando backup...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" />Crear Backup</>
              )}
            </Button>
            <Button variant="outline" onClick={loadBackups} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {isCreating && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {backupType === 'docker' 
                    ? 'Guardando imágenes Docker (esto puede tardar varios minutos)...'
                    : backupType === 'full'
                    ? 'Creando backup completo (DB + configuración)...'
                    : 'Creando backup...'}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Subir Backup
          </CardTitle>
          <CardDescription>
            Sube un archivo de backup desde tu computadora al servidor VPS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <label className="flex-1 w-full">
              <input
                type="file"
                accept=".sql,.gz,.tar,.tar.gz,.tgz,.zip,.bak"
                onChange={handleUpload}
                disabled={isUploading}
                className="hidden"
                id="backup-upload-input"
              />
              <div className="flex items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors border-muted-foreground/25">
                {isUploading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Subiendo backup...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Upload className="h-6 w-6" />
                    <span className="text-sm font-medium">Clic para seleccionar archivo</span>
                    <span className="text-xs">.sql, .gz, .tar, .zip, .bak</span>
                  </div>
                )}
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Backups List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Backups Guardados
          </CardTitle>
          <CardDescription>
            Backups almacenados en el servidor VPS
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <HardDrive className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No hay backups guardados</p>
              <p className="text-sm mt-1">Crea tu primer backup usando el botón de arriba</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup) => (
                <div
                  key={backup.name}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {typeIcon(backup.type)}
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate">{backup.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {typeBadge(backup.type)}
                        <span className="text-xs text-muted-foreground">{backup.sizeFormatted}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(backup.created).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(backup.name)}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" /> Descargar
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" disabled={isRestoring === backup.name}>
                          {isRestoring === backup.name ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <><Upload className="h-3.5 w-3.5 mr-1" /> Restaurar</>
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            ¿Restaurar backup?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Esto sobrescribirá los datos actuales con el backup: <strong>{backup.name}</strong>.
                            {backup.type === 'database' && ' Se reemplazará toda la base de datos.'}
                            {backup.type === 'docker' && ' Se cargarán las imágenes Docker guardadas.'}
                            {backup.type === 'full' && ' Se restaurará la base de datos y la configuración.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRestore(backup.name)}>
                            Sí, restaurar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar backup?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará permanentemente: <strong>{backup.name}</strong>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(backup.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>Backups protegen contra:</strong></p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Links de descarga que dejen de funcionar (imágenes Docker guardadas localmente)</li>
                <li>Pérdida de datos de la base de datos</li>
                <li>Configuración corrupta o perdida</li>
                <li>Migración a otro VPS (solo copia el backup y restaura)</li>
              </ul>
              <p className="mt-2"><strong>Tip:</strong> Usa el backup de <em>Imágenes Docker</em> para guardar PHPNuxBill y otras imágenes construidas. Si los repos originales desaparecen, podrás restaurar desde tu backup.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
