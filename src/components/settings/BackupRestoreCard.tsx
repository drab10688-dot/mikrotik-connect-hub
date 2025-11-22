import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Database, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportMikroTikConfig, importMikroTikConfig, getMikroTikCredentials } from "@/lib/mikrotik";
import { Label } from "@/components/ui/label";

export function BackupRestoreCard() {
  const [exportSection, setExportSection] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importScript, setImportScript] = useState("");

  const isConnected = !!getMikroTikCredentials();

  const handleExport = async () => {
    if (!isConnected) {
      toast.error("Debes conectarte a un MikroTik primero");
      return;
    }

    setIsExporting(true);
    try {
      const result = await exportMikroTikConfig(exportSection as any);
      
      // Construir el contenido del archivo RSC
      let rscContent = `# MikroTik Backup - ${new Date().toLocaleString()}\n`;
      rscContent += `# Sección: ${exportSection}\n\n`;
      
      if (Array.isArray(result)) {
        for (const section of result) {
          rscContent += `\n# ${section.command}\n`;
          if (Array.isArray(section.data)) {
            // Si es un array de objetos, convertirlos a comandos RSC
            for (const item of section.data) {
              rscContent += `${JSON.stringify(item)}\n`;
            }
          } else {
            rscContent += `${JSON.stringify(section.data)}\n`;
          }
        }
      } else {
        rscContent += JSON.stringify(result, null, 2);
      }

      // Crear y descargar el archivo
      const blob = new Blob([rscContent], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mikrotik-backup-${exportSection}-${Date.now()}.rsc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Backup descargado correctamente");
    } catch (error) {
      console.error("Error al exportar:", error);
      toast.error("Error al exportar la configuración", {
        description: (error as Error).message,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!isConnected) {
      toast.error("Debes conectarte a un MikroTik primero");
      return;
    }

    if (!importScript.trim()) {
      toast.error("Debes pegar el contenido del script RSC");
      return;
    }

    setIsImporting(true);
    try {
      const result = await importMikroTikConfig(importScript);
      
      const successCount = result.filter((r: any) => r.success).length;
      const failCount = result.filter((r: any) => !r.success).length;

      if (failCount === 0) {
        toast.success(`Configuración importada correctamente (${successCount} comandos)`);
        setImportScript("");
      } else {
        toast.warning(`Importación parcial: ${successCount} éxitos, ${failCount} fallos`, {
          description: "Revisa la consola para más detalles",
        });
        console.log("Resultados de importación:", result);
      }
    } catch (error) {
      console.error("Error al importar:", error);
      toast.error("Error al importar la configuración", {
        description: (error as Error).message,
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportScript(content);
      toast.success("Archivo cargado correctamente");
    };
    reader.readAsText(file);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle>Backup y Restore</CardTitle>
            <CardDescription>
              Exporta e importa la configuración del MikroTik en formato RSC
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isConnected && (
          <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <p className="text-sm text-orange-600 dark:text-orange-400">
              Debes conectarte a un dispositivo MikroTik primero
            </p>
          </div>
        )}

        {/* Export Section */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Exportar Configuración</Label>
          <div className="space-y-3">
            <div>
              <Label htmlFor="export-section" className="text-sm">Sección a exportar</Label>
              <Select value={exportSection} onValueChange={setExportSection} disabled={!isConnected}>
                <SelectTrigger id="export-section">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo (PPPoE + Hotspot + Queues)</SelectItem>
                  <SelectItem value="pppoe-users">Usuarios PPPoE</SelectItem>
                  <SelectItem value="pppoe-profiles">Perfiles PPPoE</SelectItem>
                  <SelectItem value="hotspot-users">Usuarios Hotspot</SelectItem>
                  <SelectItem value="hotspot-profiles">Perfiles Hotspot</SelectItem>
                  <SelectItem value="simple-queues">Simple Queues</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={handleExport} 
              className="w-full" 
              disabled={!isConnected || isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Descargar Backup (.rsc)
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="border-t" />

        {/* Import Section */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Importar Configuración</Label>
          <div className="space-y-3">
            <div>
              <Label htmlFor="import-script" className="text-sm">Script RSC</Label>
              <Textarea
                id="import-script"
                placeholder="Pega aquí el contenido del archivo .rsc o carga un archivo..."
                value={importScript}
                onChange={(e) => setImportScript(e.target.value)}
                className="min-h-[200px] font-mono text-xs"
                disabled={!isConnected}
              />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="file"
                  accept=".rsc,.txt"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={!isConnected}
                />
                <Button 
                  variant="outline" 
                  className="w-full"
                  disabled={!isConnected}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Cargar archivo .rsc
                </Button>
              </div>
              <Button 
                onClick={handleImport} 
                disabled={!isConnected || isImporting || !importScript.trim()}
                className="flex-1"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Restaurar Backup
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Nota:</strong> El backup incluye usuarios, perfiles y queues según la sección seleccionada. 
            Al restaurar, los comandos se ejecutarán en el orden del archivo. Asegúrate de tener un backup antes de restaurar.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
