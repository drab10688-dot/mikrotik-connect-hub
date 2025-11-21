import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Wifi, Activity, HardDrive, Ticket, Settings, ArrowUpDown } from "lucide-react";
import { useSystemResources, useHotspotActiveUsers, usePPPoEActive } from "@/hooks/useMikrotikData";
import { SystemAlerts } from "@/components/notifications/SystemAlerts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUserDeviceAccess } from "@/hooks/useUserDeviceAccess";
import { Shield } from "lucide-react";
import { AddDeviceDialog } from "@/components/settings/AddDeviceDialog";

const Dashboard = () => {
  const navigate = useNavigate();
  const { hasDeviceAccess, isLoading: loadingAccess } = useUserDeviceAccess();
  const { data: systemInfo, isLoading: loadingSystem } = useSystemResources();
  const { data: hotspotActiveData, isLoading: loadingHotspot } = useHotspotActiveUsers();
  const { data: pppoeActiveData, isLoading: loadingPPPoE } = usePPPoEActive();

  const hotspotActive = (hotspotActiveData as any[]) || [];
  const pppoeActive = (pppoeActiveData as any[]) || [];
  const totalActiveUsers = hotspotActive.length + pppoeActive.length;

  const systemData = (systemInfo as any[])?.[0];

  useEffect(() => {
    const isConnected = localStorage.getItem("mikrotik_connected");
    if (!isConnected) {
      navigate("/settings");
    }
  }, [navigate]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const cpuLoad = systemData?.['cpu-load'] || '0';
  const totalMemory = parseInt(systemData?.['total-memory'] || '0');
  const freeMemory = parseInt(systemData?.['free-memory'] || '0');
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0;

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

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

  if (loadingAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="ml-64 p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  if (!hasDeviceAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="ml-64 p-8 flex items-center justify-center">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-muted-foreground" />
              </div>
              <CardTitle className="text-2xl">Sin Acceso a Dispositivos</CardTitle>
              <CardDescription className="text-base mt-2">
                No tienes dispositivos MikroTik asignados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Puedes agregar tu propio dispositivo MikroTik para que el administrador lo revise y active.
                </p>
              </div>
              <div className="flex justify-center">
                <AddDeviceDialog />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
                  <p className="text-sm font-medium text-muted-foreground">Hotspot Activos</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingHotspot ? "..." : hotspotActive.length}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Usuarios conectados
                  </p>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Wifi className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">PPPoE Activos</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingPPPoE ? "..." : pppoeActive.length}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Conexiones activas
                  </p>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Users className="w-6 h-6 text-green-500" />
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
                    {loadingSystem ? "..." : (systemData?.uptime || "N/A")}
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
              ) : systemData ? (
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Versión:</span>
                    <span className="text-sm font-medium">{systemData.version}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Placa:</span>
                    <span className="text-sm font-medium">{systemData['board-name']}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">CPU:</span>
                    <span className="text-sm font-medium">{systemData['cpu']}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Núcleos CPU:</span>
                    <span className="text-sm font-medium">{systemData['cpu-count']}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm text-muted-foreground">Arquitectura:</span>
                    <span className="text-sm font-medium">{systemData['architecture-name']}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No hay información disponible</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios Hotspot Activos</CardTitle>
              <CardDescription>Conexiones hotspot en tiempo real</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHotspot ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : hotspotActive.length > 0 ? (
                <div className="space-y-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Perfil</TableHead>
                        <TableHead className="text-right">Tiempo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hotspotActive.slice(0, 5).map((user: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{user.user || 'Sin nombre'}</TableCell>
                          <TableCell>{user.address || 'Sin IP'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{user.profile || 'default'}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">{user.uptime || '0s'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {hotspotActive.length > 5 && (
                    <Button 
                      variant="ghost" 
                      className="w-full mt-2"
                      onClick={() => navigate("/users")}
                    >
                      Ver todos ({hotspotActive.length})
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">No hay usuarios activos</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios PPPoE Activos</CardTitle>
              <CardDescription>Conexiones PPPoE en tiempo real</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPPPoE ? (
                <p className="text-muted-foreground">Cargando...</p>
              ) : pppoeActive.length > 0 ? (
                <div className="space-y-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>IP Local</TableHead>
                        <TableHead>Perfil</TableHead>
                        <TableHead className="text-right">Tiempo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pppoeActive.slice(0, 5).map((user: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{user.name || 'Sin nombre'}</TableCell>
                          <TableCell>{user['local-address'] || 'Sin IP'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{user.profile || 'default'}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">{user.uptime || '0s'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {pppoeActive.length > 5 && (
                    <Button 
                      variant="ghost" 
                      className="w-full mt-2"
                      onClick={() => navigate("/ppp")}
                    >
                      Ver todos ({pppoeActive.length})
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
