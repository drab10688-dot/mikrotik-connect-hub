import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { useSystemResources, useHotspotActiveUsers, usePPPoEActive } from "@/hooks/useMikrotikData";

export const SystemAlerts = () => {
  const { data: systemResources } = useSystemResources();
  const { data: hotspotActive } = useHotspotActiveUsers();
  const { data: pppoeActive } = usePPPoEActive();

  const alerts: {
    type: "info" | "warning" | "error";
    title: string;
    description: string;
  }[] = [];

  // systemResources is already an array (from getSystemInfo)
  const sysData = Array.isArray(systemResources) ? systemResources[0] : systemResources;

  // Check CPU usage
  if (sysData?.["cpu-load"]) {
    const cpuLoad = parseInt(sysData["cpu-load"]);
    if (cpuLoad > 80) {
      alerts.push({
        type: "error",
        title: "Uso de CPU Alto",
        description: `La CPU está al ${cpuLoad}% de uso. Considere revisar los procesos activos.`,
      });
    } else if (cpuLoad > 60) {
      alerts.push({
        type: "warning",
        title: "Uso de CPU Elevado",
        description: `La CPU está al ${cpuLoad}% de uso.`,
      });
    }
  }

  // Check memory usage
  if (sysData?.["free-memory"] && sysData?.["total-memory"]) {
    const freeMemory = parseInt(sysData["free-memory"]);
    const totalMemory = parseInt(sysData["total-memory"]);
    const usedPercentage = ((totalMemory - freeMemory) / totalMemory) * 100;

    if (usedPercentage > 90) {
      alerts.push({
        type: "error",
        title: "Memoria Crítica",
        description: `La memoria está al ${usedPercentage.toFixed(1)}% de uso.`,
      });
    } else if (usedPercentage > 75) {
      alerts.push({
        type: "warning",
        title: "Memoria Elevada",
        description: `La memoria está al ${usedPercentage.toFixed(1)}% de uso.`,
      });
    }
  }

  // Check connection load
  const hotspotCount = Array.isArray(hotspotActive) ? hotspotActive.length : 0;
  const pppoeCount = Array.isArray(pppoeActive) ? pppoeActive.length : 0;
  const totalConnections = hotspotCount + pppoeCount;
  
  if (totalConnections > 100) {
    alerts.push({
      type: "warning",
      title: "Alta Carga de Conexiones",
      description: `Hay ${totalConnections} conexiones activas en el sistema.`,
    });
  }

  if (alerts.length === 0) {
    return (
      <Alert className="border-primary/50 bg-primary/5">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <AlertTitle>Sistema Saludable</AlertTitle>
        <AlertDescription>
          Todos los sistemas operan normalmente.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {alerts.map((alert, index) => (
        <Alert
          key={index}
          variant={alert.type === "error" ? "destructive" : "default"}
          className={
            alert.type === "warning"
              ? "border-warning bg-warning/5"
              : alert.type === "info"
              ? "border-info bg-info/5"
              : ""
          }
        >
          {alert.type === "error" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : alert.type === "warning" ? (
            <AlertTriangle className="h-4 w-4 text-warning" />
          ) : (
            <Info className="h-4 w-4 text-info" />
          )}
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.description}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
};
