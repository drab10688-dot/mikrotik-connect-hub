import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Database, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSelectedDeviceId, getPPPoEUsers, getHotspotUsers } from "@/lib/mikrotik";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export function BackupRestoreCard() {
  const [exportSection, setExportSection] = useState<string>("all");
  const [exportFormat, setExportFormat] = useState<string>("api");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importScript, setImportScript] = useState("");

  const mikrotikId = getSelectedDeviceId();
  const isConnected = !!mikrotikId;

  const convertToRSC = (data: any[], command: string, format: string = "api"): string => {
    let rsc = `\n# ${command}\n`;
    
    const terminalCommand = format === "terminal" 
      ? command.replace(/\/add$/, ' add').replace(/\//g, ' ').trim()
      : command;
    
    for (const item of data) {
      let cmd = format === "terminal" ? `/${terminalCommand}` : command;
      
      for (const [key, value] of Object.entries(item)) {
        if (key.startsWith('.') || key === 'dynamic' || key === 'invalid' || key === 'default') continue;
        if (key.includes('bytes') || key.includes('packets') || key.includes('rate')) continue;
        if (key === 'uptime' || key === 'encoding' || key === 'session-id' || key === 'radius') continue;
        if (key === 'last-logged-out' || key === 'last-caller-id' || key === 'last-disconnect-reason') continue;
        if (key === 'creation-time' || key === 'queued-packets' || key === 'queued-bytes') continue;
        if (key === 'dropped' || key === 'total-dropped' || key === 'total-queued-packets') continue;
        if (key === 'total-queued-bytes' || key === 'pcq-queues' || key === 'bucket-size') continue;
        
        const val = String(value);
        
        if (!val || val === '' || val === 'none' || val === 'false') continue;
        if (val === '0' || val === '0s' || val === '0/0' || val === '0s/0s') continue;
        if (val === '0.0.0.0' || val === '::' || val === '0.1/0.1') continue;
        
        if (format === "terminal") {
          const needsQuotes = val.includes(' ') || val.includes('/') || val.includes('\\');
          cmd += needsQuotes ? ` ${key}="${val}"` : ` ${key}=${val}`;
        } else {
          const escapedVal = val.replace(/"/g, '\\"');
          cmd += ` ${key}="${escapedVal}"`;
        }
      }
      
      rsc += cmd + '\n';
    }
    
    return rsc;
  };

  const handleExport = async () => {
    if (!mikrotikId) {
      toast.error("Debes conectarte a un MikroTik primero");
      return;
    }

    setIsExporting(true);
    try {
      let rscContent = `# MikroTik Backup - ${new Date().toLocaleString()}\n`;
      rscContent += `# Sección: ${exportSection}\n`;
      rscContent += `# Formato: ${exportFormat === "terminal" ? "Terminal CLI" : "API"}\n`;
      rscContent += `# Generado por MikroTik Manager\n\n`;
      
      if (exportSection === 'all') {
        const [pppoeUsers, pppoeProfiles, hotspotUsers, hotspotProfiles, simpleQueues] = await Promise.all([
          getPPPoEUsers(),
          supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'pppoe-profiles',
              params: {}
            }
          }),
          getHotspotUsers(),
          supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'hotspot-profiles',
              params: {}
            }
          }),
          supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'simple-queues',
              params: {}
            }
          })
        ]);
        
        rscContent += convertToRSC(pppoeUsers, '/ppp/secret/add', exportFormat);
        if (pppoeProfiles.data?.success) {
          rscContent += convertToRSC(pppoeProfiles.data.data, '/ppp/profile/add', exportFormat);
        }
        rscContent += convertToRSC(hotspotUsers, '/ip/hotspot/user/add', exportFormat);
        if (hotspotProfiles.data?.success) {
          rscContent += convertToRSC(hotspotProfiles.data.data, '/ip/hotspot/user/profile/add', exportFormat);
        }
        if (simpleQueues.data?.success) {
          rscContent += convertToRSC(simpleQueues.data.data, '/queue/simple/add', exportFormat);
        }
      } else {
        if (exportSection === 'pppoe-users') {
          const users = await getPPPoEUsers();
          rscContent += convertToRSC(users, '/ppp/secret/add', exportFormat);
        } else if (exportSection === 'pppoe-profiles') {
          const { data } = await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'pppoe-profiles',
              params: {}
            }
          });
          if (data?.success) {
            rscContent += convertToRSC(data.data, '/ppp/profile/add', exportFormat);
          }
        } else if (exportSection === 'hotspot-users') {
          const users = await getHotspotUsers();
          rscContent += convertToRSC(users, '/ip/hotspot/user/add', exportFormat);
        } else if (exportSection === 'hotspot-profiles') {
          const { data } = await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'hotspot-profiles',
              params: {}
            }
          });
          if (data?.success) {
            rscContent += convertToRSC(data.data, '/ip/hotspot/user/profile/add', exportFormat);
          }
        } else if (exportSection === 'simple-queues') {
          const { data } = await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'simple-queues',
              params: {}
            }
          });
          if (data?.success) {
            rscContent += convertToRSC(data.data, '/queue/simple/add', exportFormat);
          }
        }
      }

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
    if (!mikrotikId) {
      toast.error("Debes conectarte a un MikroTik primero");
      return;
    }

    if (!importScript.trim()) {
      toast.error("Debes pegar el contenido del script RSC");
      return;
    }

    setIsImporting(true);
    try {
      const lines = importScript.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && trimmed.length > 10;
      });
      
      let successCount = 0;
      let failCount = 0;
      
      for (const line of lines) {
        try {
          const { data, error } = await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: line.trim(),
              params: {}
            }
          });
          
          if (error || !data?.success) {
            failCount++;
            console.error('Error en línea:', line, error || data?.error);
          } else {
            successCount++;
          }
        } catch (err) {
          failCount++;
          console.error('Error ejecutando:', line, err);
        }
      }

      if (failCount === 0) {
        toast.success(`Configuración restaurada (${successCount} comandos)`);
        setImportScript("");
      } else {
        toast.warning(`Importación parcial: ${successCount} éxitos, ${failCount} fallos`, {
          description: "Revisa la consola del navegador para más detalles",
        });
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
            <div>
              <Label htmlFor="export-format" className="text-sm">Formato de exportación</Label>
              <Select value={exportFormat} onValueChange={setExportFormat} disabled={!isConnected}>
                <SelectTrigger id="export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">Formato API (para importar aquí)</SelectItem>
                  <SelectItem value="terminal">Formato Terminal (para pegar en MikroTik)</SelectItem>
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
            Formato API: para importar usando la función de restaurar. Formato Terminal: para copiar y pegar 
            directamente en el terminal de MikroTik. Asegúrate de tener un backup antes de restaurar.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
