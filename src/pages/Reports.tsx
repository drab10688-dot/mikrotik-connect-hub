import { useState, useRef, useMemo } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Download, TrendingUp, Users, Wifi, Activity, Calendar, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useHotspotActiveUsers, usePPPoEActive, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "@/hooks/use-toast";

type TimeRange = "daily" | "weekly" | "monthly";

export default function Reports() {
  const [timeRange, setTimeRange] = useState<TimeRange>("weekly");
  const [activeTab, setActiveTab] = useState("overview");
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: hotspotActive, isLoading: loadingHotspotActive } = useHotspotActiveUsers();
  const { data: pppoeActive, isLoading: loadingPPPoEActive } = usePPPoEActive();
  const { data: hotspotUsers, isLoading: loadingHotspotUsers } = useHotspotUsers();
  const { data: pppoeUsers, isLoading: loadingPPPoEUsers } = usePPPoEUsers();

  const isLoading = loadingHotspotActive || loadingPPPoEActive || loadingHotspotUsers || loadingPPPoEUsers;

  // Calculate real statistics from MikroTik data
  const stats = useMemo(() => {
    const totalHotspotActive = Array.isArray(hotspotActive?.data) ? hotspotActive.data.length : 0;
    const totalPPPoEActive = Array.isArray(pppoeActive?.data) ? pppoeActive.data.length : 0;
    const totalActive = totalHotspotActive + totalPPPoEActive;
    
    const totalHotspotUsers = Array.isArray(hotspotUsers?.data) ? hotspotUsers.data.length : 0;
    const totalPPPoEUsers = Array.isArray(pppoeUsers?.data) ? pppoeUsers.data.length : 0;
    const totalRegistered = totalHotspotUsers + totalPPPoEUsers;
    
    const hotspotActiveRate = totalHotspotUsers > 0 ? (totalHotspotActive / totalHotspotUsers * 100).toFixed(1) : "0";
    const pppoeActiveRate = totalPPPoEUsers > 0 ? (totalPPPoEActive / totalPPPoEUsers * 100).toFixed(1) : "0";
    const totalActiveRate = totalRegistered > 0 ? (totalActive / totalRegistered * 100).toFixed(1) : "0";
    
    return {
      totalActive,
      totalHotspotActive,
      totalPPPoEActive,
      totalRegistered,
      totalHotspotUsers,
      totalPPPoEUsers,
      hotspotActiveRate,
      pppoeActiveRate,
      totalActiveRate
    };
  }, [hotspotActive, pppoeActive, hotspotUsers, pppoeUsers]);

  // Distribution data for charts
  const connectionTypeData = useMemo(() => [
    { name: "Hotspot Registrados", value: stats.totalHotspotUsers, color: 'hsl(var(--primary))' },
    { name: "Hotspot Activos", value: stats.totalHotspotActive, color: 'hsl(var(--success))' },
    { name: "PPPoE Registrados", value: stats.totalPPPoEUsers, color: 'hsl(var(--warning))' },
    { name: "PPPoE Activos", value: stats.totalPPPoEActive, color: 'hsl(var(--chart-2))' },
  ], [stats]);

  const usageData = useMemo(() => [
    { name: "Activos", value: stats.totalActive, color: 'hsl(var(--success))' },
    { name: "Inactivos", value: stats.totalRegistered - stats.totalActive, color: 'hsl(var(--muted-foreground))' },
  ], [stats]);

  const exportToPDF = async () => {
    if (!reportRef.current) return;

    try {
      toast({
        title: "Generando PDF",
        description: "Por favor espere...",
      });

      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= 297;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= 297;
      }

      const fileName = `reporte-${timeRange}-${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);

      toast({
        title: "PDF Generado",
        description: "El reporte se ha descargado correctamente.",
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        title: "Error",
        description: "No se pudo generar el PDF.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent flex items-center gap-2">
                <Activity className="w-6 h-6 md:w-8 md:h-8 text-primary flex-shrink-0" />
                Reportes y Estadísticas
              </h1>
              <p className="text-sm md:text-base text-muted-foreground mt-2">
                Análisis en tiempo real de conexiones MikroTik
              </p>
            </div>
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <Select value={timeRange} onValueChange={(value: TimeRange) => setTimeRange(value)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Últimas 24 horas</SelectItem>
                  <SelectItem value="weekly">Última semana</SelectItem>
                  <SelectItem value="monthly">Último mes</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={exportToPDF} className="gap-2 w-full sm:w-auto" variant="default">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Exportar</span>
              </Button>
            </div>
          </div>

          <div ref={reportRef} className="space-y-4 md:space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center space-y-2">
                  <Activity className="h-8 w-8 animate-spin mx-auto text-primary" />
                  <p className="text-sm text-muted-foreground">Cargando datos de MikroTik...</p>
                </div>
              </div>
            ) : (
              <>
                {/* Real-time Data Notice */}
                <Alert className="border-primary/50 bg-primary/5">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  <AlertDescription className="text-xs md:text-sm">
                    Los datos mostrados son en tiempo real desde tu dispositivo MikroTik. Para análisis históricos, los datos se actualizan según el periodo seleccionado.
                  </AlertDescription>
                </Alert>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  <Card className="border-l-4 border-l-primary hover:shadow-lg transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-xs md:text-sm font-medium">Conexiones Activas</CardTitle>
                      <div className="p-2 bg-primary/10 rounded-full">
                        <Activity className="h-3 w-3 md:h-4 md:w-4 text-primary" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl md:text-2xl lg:text-3xl font-bold">{stats.totalActive}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {stats.totalActiveRate}% activos
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          de {stats.totalRegistered}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-success hover:shadow-lg transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-xs md:text-sm font-medium">Hotspot Activos</CardTitle>
                      <div className="p-2 bg-success/10 rounded-full">
                        <Wifi className="h-3 w-3 md:h-4 md:w-4 text-success" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl md:text-2xl lg:text-3xl font-bold">{stats.totalHotspotActive}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs border-success text-success">
                          {stats.hotspotActiveRate}% tasa
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          de {stats.totalHotspotUsers}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-warning hover:shadow-lg transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-xs md:text-sm font-medium">PPPoE Activos</CardTitle>
                      <div className="p-2 bg-warning/10 rounded-full">
                        <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-warning" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl md:text-2xl lg:text-3xl font-bold">{stats.totalPPPoEActive}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs border-warning text-warning">
                          {stats.pppoeActiveRate}% tasa
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          de {stats.totalPPPoEUsers}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-l-4 border-l-primary hover:shadow-lg transition-all">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-xs md:text-sm font-medium">Total Usuarios</CardTitle>
                      <div className="p-2 bg-primary/10 rounded-full">
                        <Users className="h-3 w-3 md:h-4 md:w-4 text-primary" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl md:text-2xl lg:text-3xl font-bold">{stats.totalRegistered}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          Hotspot
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          PPPoE
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Tabs */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 max-w-md">
                    <TabsTrigger value="overview" className="text-xs md:text-sm">Resumen</TabsTrigger>
                    <TabsTrigger value="trends" className="text-xs md:text-sm">Distribución</TabsTrigger>
                    <TabsTrigger value="details" className="text-xs md:text-sm hidden md:inline-flex">Detalles</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4 mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">Estado Actual de Conexiones</CardTitle>
                        <CardDescription className="text-xs md:text-sm">Datos en tiempo real desde MikroTik</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Hotspot</span>
                              <Wifi className="h-4 w-4 text-success" />
                            </div>
                            <div className="text-2xl font-bold text-success">{stats.totalHotspotActive}</div>
                            <p className="text-xs text-muted-foreground">
                              {stats.totalHotspotUsers} usuarios registrados
                            </p>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div 
                                className="bg-success rounded-full h-2 transition-all" 
                                style={{ width: `${stats.hotspotActiveRate}%` }}
                              />
                            </div>
                          </div>

                          <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">PPPoE</span>
                              <TrendingUp className="h-4 w-4 text-warning" />
                            </div>
                            <div className="text-2xl font-bold text-warning">{stats.totalPPPoEActive}</div>
                            <p className="text-xs text-muted-foreground">
                              {stats.totalPPPoEUsers} usuarios registrados
                            </p>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div 
                                className="bg-warning rounded-full h-2 transition-all" 
                                style={{ width: `${stats.pppoeActiveRate}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="trends" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Connection Type Distribution */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base md:text-lg">Distribución por Tipo</CardTitle>
                          <CardDescription className="text-xs md:text-sm">Usuarios registrados vs activos</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={connectionTypeData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis 
                                dataKey="name" 
                                stroke="hsl(var(--muted-foreground))"
                                style={{ fontSize: '10px' }}
                                angle={-15}
                                textAnchor="end"
                                height={80}
                              />
                              <YAxis 
                                stroke="hsl(var(--muted-foreground))"
                                style={{ fontSize: '10px' }}
                              />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--card))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '8px',
                                  fontSize: '12px'
                                }}
                              />
                              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                                {connectionTypeData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      {/* Usage Pie Chart */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base md:text-lg">Distribución de Uso</CardTitle>
                          <CardDescription className="text-xs md:text-sm">Activos vs inactivos</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                              <Pie
                                data={usageData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                outerRadius={80}
                                dataKey="value"
                              >
                                {usageData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--card))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '8px',
                                  fontSize: '12px'
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="details" className="space-y-4 mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">Resumen Detallado</CardTitle>
                        <CardDescription className="text-xs md:text-sm">Información completa del sistema</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 md:space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                          <div className="space-y-4">
                            <h3 className="font-semibold text-base md:text-lg flex items-center gap-2">
                              <Wifi className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                              Hotspot
                            </h3>
                            <div className="space-y-3">
                              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Usuarios Registrados</span>
                                  <span className="font-bold text-sm md:text-base">{stats.totalHotspotUsers}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Usuarios Activos</span>
                                  <span className="font-bold text-success text-sm md:text-base">{stats.totalHotspotActive}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Tasa de Actividad</span>
                                  <Badge variant="secondary" className="text-xs">
                                    {stats.hotspotActiveRate}%
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <h3 className="font-semibold text-base md:text-lg flex items-center gap-2">
                              <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-warning" />
                              PPPoE
                            </h3>
                            <div className="space-y-3">
                              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Usuarios Registrados</span>
                                  <span className="font-bold text-sm md:text-base">{stats.totalPPPoEUsers}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Usuarios Activos</span>
                                  <span className="font-bold text-success text-sm md:text-base">{stats.totalPPPoEActive}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs md:text-sm text-muted-foreground">Tasa de Actividad</span>
                                  <Badge variant="secondary" className="text-xs">
                                    {stats.pppoeActiveRate}%
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
