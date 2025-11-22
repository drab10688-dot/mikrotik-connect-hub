import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ArrowDown, ArrowUp, TrendingUp } from "lucide-react";

const Traffic = () => {
  const interfaces = [
    { name: "ether1-wan", rx: "1.2 TB", tx: "850 GB", speed: "1000 Mbps", status: "running" },
    { name: "ether2-lan", rx: "2.5 TB", tx: "1.8 TB", speed: "1000 Mbps", status: "running" },
    { name: "wlan1", rx: "450 GB", tx: "320 GB", speed: "300 Mbps", status: "running" },
    { name: "bridge-local", rx: "3.1 TB", tx: "2.3 TB", speed: "N/A", status: "running" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Monitor de Tráfico</h1>
          <p className="text-muted-foreground">Estadísticas de uso de red por interfaz</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-primary p-6 text-white">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium opacity-90">Tráfico Total RX</p>
                    <p className="text-3xl font-bold">7.25 TB</p>
                    <p className="text-sm opacity-75">Este mes</p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <ArrowDown className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-success p-6 text-white">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium opacity-90">Tráfico Total TX</p>
                    <p className="text-3xl font-bold">5.27 TB</p>
                    <p className="text-sm opacity-75">Este mes</p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <ArrowUp className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-warning p-6 text-white">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium opacity-90">Velocidad Promedio</p>
                    <p className="text-3xl font-bold">38.5 Mbps</p>
                    <p className="text-sm opacity-75">
                      <TrendingUp className="w-3 h-3 inline mr-1" />
                      +12% vs ayer
                    </p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-lg">
                    <Activity className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tráfico por Interfaz</CardTitle>
            <CardDescription>Estadísticas detalladas de cada interfaz de red</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {interfaces.map((iface) => (
                <div
                  key={iface.name}
                  className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-medium">{iface.name}</h3>
                      <p className="text-sm text-muted-foreground">Velocidad: {iface.speed}</p>
                    </div>
                    <div className="px-3 py-1 rounded-full bg-success/10 text-success text-sm font-medium">
                      {iface.status}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5">
                      <ArrowDown className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-xs text-muted-foreground">Recibido (RX)</p>
                        <p className="text-lg font-bold text-primary">{iface.rx}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-success/5">
                      <ArrowUp className="w-5 h-5 text-success" />
                      <div>
                        <p className="text-xs text-muted-foreground">Transmitido (TX)</p>
                        <p className="text-lg font-bold text-success">{iface.tx}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Traffic;
