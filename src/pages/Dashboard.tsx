import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Wifi, Activity, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Dashboard = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const isConnected = localStorage.getItem("mikrotik_connected");
    if (!isConnected) {
      navigate("/");
    }
  }, [navigate]);

  const activeUsers = [
    { name: "user_001", ip: "10.5.50.2", mac: "00:11:22:33:44:55", uptime: "01:23:45", status: "active" },
    { name: "user_002", ip: "10.5.50.3", mac: "00:11:22:33:44:56", uptime: "00:45:12", status: "active" },
    { name: "user_003", ip: "10.5.50.4", mac: "00:11:22:33:44:57", uptime: "02:15:30", status: "active" },
    { name: "user_004", ip: "10.5.50.5", mac: "00:11:22:33:44:58", uptime: "00:12:05", status: "active" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Vista general del sistema</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Usuarios Activos"
            value={24}
            icon={Users}
            trend="+3 desde ayer"
            gradient="gradient-primary"
          />
          <StatsCard
            title="Conexiones PPP"
            value={12}
            icon={Wifi}
            trend="8 activas"
            gradient="gradient-success"
          />
          <StatsCard
            title="Tráfico Total"
            value="145 GB"
            icon={Activity}
            trend="+12.5% este mes"
            gradient="gradient-warning"
          />
          <StatsCard
            title="Uso CPU"
            value="23%"
            icon={HardDrive}
            trend="Normal"
            gradient="gradient-danger"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Usuarios Activos</CardTitle>
              <CardDescription>Usuarios conectados actualmente</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {activeUsers.map((user) => (
                  <div
                    key={user.name}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-sm">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.ip} • {user.mac}</p>
                    </div>
                    <div className="text-right space-y-1">
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                        Activo
                      </Badge>
                      <p className="text-xs text-muted-foreground">{user.uptime}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tráfico en Tiempo Real</CardTitle>
              <CardDescription>Últimas 24 horas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Download</span>
                    <span className="text-sm text-muted-foreground">85.3 GB</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-primary" style={{ width: "75%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Upload</span>
                    <span className="text-sm text-muted-foreground">59.7 GB</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-success" style={{ width: "60%" }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="p-3 rounded-lg bg-primary/5">
                    <p className="text-xs text-muted-foreground">Velocidad RX</p>
                    <p className="text-lg font-bold text-primary">45.2 Mbps</p>
                  </div>
                  <div className="p-3 rounded-lg bg-success/5">
                    <p className="text-xs text-muted-foreground">Velocidad TX</p>
                    <p className="text-lg font-bold text-success">32.8 Mbps</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
