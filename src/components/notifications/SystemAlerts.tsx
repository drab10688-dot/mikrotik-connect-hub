import { useEffect } from "react";
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

  // Check CPU usage
  if (systemResources?.data?.[0]?.["cpu-load"]) {
    const cpuLoad = parseInt(systemResources.data[0]["cpu-load"]);
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
  if (systemResources?.data?.[0]?.["free-memory"] && systemResources?.data?.[0]?.["total-memory"]) {
    const freeMemory = parseInt(systemResources.data[0]["free-memory"]);
    const totalMemory = parseInt(systemResources.data[0]["total-memory"]);
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
  const totalConnections = (hotspotActive?.data?.length || 0) + (pppoeActive?.data?.length || 0);
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
