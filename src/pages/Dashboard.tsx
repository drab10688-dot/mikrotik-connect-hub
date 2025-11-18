import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Wifi, Activity, HardDrive, Ticket, Settings } from "lucide-react";
import { useSystemResources, useHotspotActiveUsers } from "@/hooks/useMikrotikData";
import { SystemAlerts } from "@/components/notifications/SystemAlerts";

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: systemInfo, isLoading: loadingSystem } = useSystemResources();
  const { data: activeUsers, isLoading: loadingUsers } = useHotspotActiveUsers();

  useEffect(() => {
    const isConnected = localStorage.getItem("mikrotik_connected");
    if (!isConnected) {
      navigate("/");
    }
  }, [navigate]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const cpuLoad = systemInfo?.[0]?.['cpu-load'] || 0;
  const totalMemory = systemInfo?.[0]?.['total-memory'] || 0;
  const freeMemory = systemInfo?.[0]?.['free-memory'] || 0;
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0;

  const quickActions = [
    {
      title: "Usuarios Hotspot",
      description: "Administrar usuarios y perfiles",
      icon: Users,
      path: "/users",
      color: "bg-blue-500",
    },
    {
      title: "Generar Vouchers",
      description: "Crear códigos de acceso",
      icon: Ticket,
      path: "/vouchers",
      color: "bg-purple-500",
    },
    {
      title: "Gestión PPPoE",
      description: "Administrar conexiones PPPoE",
      icon: Wifi,
      path: "/ppp",
      color: "bg-green-500",
    },
    {
      title: "Configuración",
      description: "Ajustes del sistema",
      icon: Settings,
      path: "/settings",
      color: "bg-orange-500",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Panel de administración MikroTik</p>
        </div>

        {/* System Alerts */}
        <div className="mb-8">
          <SystemAlerts />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Usuarios Activos</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingUsers ? "..." : (activeUsers?.length || 0)}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Uso CPU</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingSystem ? "..." : `${cpuLoad}%`}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-orange-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Memoria RAM</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingSystem ? "..." : `${memoryPercent}%`}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatBytes(usedMemory)} / {formatBytes(totalMemory)}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                  <HardDrive className="w-6 h-6 text-purple-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Uptime</p>
                  <h3 className="text-2xl font-bold mt-2">
                    {loadingSystem ? "..." : (systemInfo?.[0]?.uptime || "N/A")}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Wifi className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Accesos Rápidos</CardTitle>
            <CardDescription>Administración de servicios MikroTik</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {quickActions.map((action) => (
                <Button
                  key={action.path}
                  variant="outline"
                  className="h-auto p-6 flex flex-col items-center gap-3 hover:border-primary"
                  onClick={() => navigate(action.path)}
                >
                  <div className={`w-12 h-12 rounded-full ${action.color} bg-opacity-10 flex items-center justify-center`}>
                    <action.icon className={`w-6 h-6 ${action.color.replace('bg-', 'text-')}`} />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{action.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System Info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Información del Sistema</CardTitle>
              <CardDescription>Detalles del router MikroTik</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSystem ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : systemInfo?.[0] ? (
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Versión:</span>
                    <span className="text-sm font-medium">{systemInfo[0].version}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Placa:</span>
                    <span className="text-sm font-medium">{systemInfo[0]['board-name']}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">CPU:</span>
                    <span className="text-sm font-medium">{systemInfo[0]['cpu']}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Núcleos CPU:</span>
                    <span className="text-sm font-medium">{systemInfo[0]['cpu-count']}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm text-muted-foreground">Arquitectura:</span>
                    <span className="text-sm font-medium">{systemInfo[0]['architecture-name']}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No hay información disponible</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios Activos</CardTitle>
              <CardDescription>Conexiones hotspot activas</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingUsers ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : activeUsers && activeUsers.length > 0 ? (
                <div className="space-y-2">
                  {activeUsers.slice(0, 5).map((user: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="font-medium text-sm">{user.user || 'Sin nombre'}</p>
                        <p className="text-xs text-muted-foreground">{user.address || 'Sin IP'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{user.uptime || '0s'}</p>
                      </div>
                    </div>
                  ))}
                  {activeUsers.length > 5 && (
                    <Button 
                      variant="ghost" 
                      className="w-full mt-2"
                      onClick={() => navigate("/users")}
                    >
                      Ver todos ({activeUsers.length})
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">No hay usuarios activos</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
