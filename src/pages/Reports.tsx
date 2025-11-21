import { useState, useRef } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, TrendingUp, Users, Wifi, Clock, Activity, ArrowUp, ArrowDown, Calendar } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { useHotspotActiveUsers, usePPPoEActive, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type TimeRange = "daily" | "weekly" | "monthly";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))'];

export default function Reports() {
  const [timeRange, setTimeRange] = useState<TimeRange>("weekly");
  const [activeTab, setActiveTab] = useState("overview");
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: hotspotActive, isLoading: loadingHotspotActive } = useHotspotActiveUsers();
  const { data: pppoeActive, isLoading: loadingPPPoEActive } = usePPPoEActive();
  const { data: hotspotUsers, isLoading: loadingHotspotUsers } = useHotspotUsers();
  const { data: pppoeUsers, isLoading: loadingPPPoEUsers } = usePPPoEUsers();

  const isLoading = loadingHotspotActive || loadingPPPoEActive || loadingHotspotUsers || loadingPPPoEUsers;

  const totalActiveConnections = (hotspotActive?.data?.length || 0) + (pppoeActive?.data?.length || 0);
  const totalHotspotUsers = hotspotUsers?.data?.length || 0;
  const totalPPPoEUsers = pppoeUsers?.data?.length || 0;
  const totalUsers = totalHotspotUsers + totalPPPoEUsers;

  // Calculate trends (mock data - in production would come from historical data)
  const connectionTrend = 12.5; // percentage increase
  const userGrowth = 8.3; // percentage increase

  // Generate mock historical data based on time range
  const generateHistoricalData = () => {
    const days = timeRange === "daily" ? 24 : timeRange === "weekly" ? 7 : 30;
    const unit = timeRange === "daily" ? "h" : "día";
    
    return Array.from({ length: days }, (_, i) => ({
      name: timeRange === "daily" ? `${i}:00` : `${unit} ${i + 1}`,
      hotspot: Math.floor(Math.random() * (hotspotActive?.data?.length || 10)) + Math.floor((hotspotActive?.data?.length || 0) * 0.5),
      pppoe: Math.floor(Math.random() * (pppoeActive?.data?.length || 5)) + Math.floor((pppoeActive?.data?.length || 0) * 0.5),
      total: 0,
    })).map(item => ({
      ...item,
      total: item.hotspot + item.pppoe,
    }));
  };

  const historicalData = generateHistoricalData();

  const connectionTypeData = [
    { name: "Hotspot", value: totalHotspotUsers, active: hotspotActive?.data?.length || 0 },
    { name: "PPPoE", value: totalPPPoEUsers, active: pppoeActive?.data?.length || 0 },
  ];

  const usageData = [
    { name: "Usuarios Activos", value: totalActiveConnections },
    { name: "Usuarios Inactivos", value: totalUsers - totalActiveConnections },
  ];

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
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Reportes y Estadísticas
              </h1>
              <p className="text-muted-foreground mt-1 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Análisis detallado de conexiones y uso de red
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={timeRange} onValueChange={(value: TimeRange) => setTimeRange(value)}>
                <SelectTrigger className="w-[180px]">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Últimas 24 horas</SelectItem>
                  <SelectItem value="weekly">Última semana</SelectItem>
                  <SelectItem value="monthly">Último mes</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={exportToPDF} className="gap-2" variant="default">
                <Download className="w-4 h-4" />
                Exportar
              </Button>
            </div>
          </div>

          <div ref={reportRef} className="space-y-6">
            {/* Summary Cards with enhanced design */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-primary hover:shadow-lg transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Conexiones Activas</CardTitle>
                  <div className="p-2 bg-primary/10 rounded-full">
                    <Wifi className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{isLoading ? "..." : totalActiveConnections}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {Math.round((totalActiveConnections / (totalUsers || 1)) * 100)}% activos
                    </Badge>
                    {connectionTrend > 0 && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <ArrowUp className="w-3 h-3" />
                        {connectionTrend}%
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-chart-1 hover:shadow-lg transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Usuarios</CardTitle>
                  <div className="p-2 bg-chart-1/10 rounded-full">
                    <Users className="h-4 w-4 text-chart-1" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{isLoading ? "..." : totalUsers}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {totalHotspotUsers} Hotspot
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {totalPPPoEUsers} PPPoE
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-chart-2 hover:shadow-lg transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Hotspot</CardTitle>
                  <div className="p-2 bg-chart-2/10 rounded-full">
                    <TrendingUp className="h-4 w-4 text-chart-2" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{isLoading ? "..." : totalHotspotUsers}</div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {hotspotActive?.data?.length || 0} activos • {totalHotspotUsers - (hotspotActive?.data?.length || 0)} inactivos
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-chart-3 hover:shadow-lg transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">PPPoE</CardTitle>
                  <div className="p-2 bg-chart-3/10 rounded-full">
                    <Clock className="h-4 w-4 text-chart-3" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{isLoading ? "..." : totalPPPoEUsers}</div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {pppoeActive?.data?.length || 0} activos • {totalPPPoEUsers - (pppoeActive?.data?.length || 0)} inactivos
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tabs for different views */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                <TabsTrigger value="overview">Resumen</TabsTrigger>
                <TabsTrigger value="trends">Tendencias</TabsTrigger>
                <TabsTrigger value="details">Detalles</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Historical Area Chart */}
                <Card className="overflow-hidden">
                  <CardHeader className="bg-gradient-to-r from-primary/10 to-chart-1/10">
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      Conexiones Activas en el Tiempo
                    </CardTitle>
                    <CardDescription>
                      Histórico de conexiones {timeRange === "daily" ? "por hora" : timeRange === "weekly" ? "diarias" : "mensuales"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <ResponsiveContainer width="100%" height={350}>
                      <AreaChart data={historicalData}>
                        <defs>
                          <linearGradient id="colorHotspot" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                          </linearGradient>
                          <linearGradient id="colorPPPoE" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis 
                          dataKey="name" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--popover))", 
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)"
                          }} 
                        />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="hotspot" 
                          stroke="hsl(var(--primary))" 
                          fillOpacity={1}
                          fill="url(#colorHotspot)"
                          strokeWidth={2} 
                          name="Hotspot" 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="pppoe" 
                          stroke="hsl(var(--chart-1))" 
                          fillOpacity={1}
                          fill="url(#colorPPPoE)"
                          strokeWidth={2} 
                          name="PPPoE" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="trends" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Connection Type Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Distribución por Tipo</CardTitle>
                      <CardDescription>Usuarios registrados vs activos</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={connectionTypeData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: "hsl(var(--popover))", 
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px"
                            }} 
                          />
                          <Legend />
                          <Bar dataKey="value" fill="hsl(var(--primary))" name="Total" radius={[8, 8, 0, 0]} />
                          <Bar dataKey="active" fill="hsl(var(--chart-2))" name="Activos" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Usage Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Estado de Usuarios</CardTitle>
                      <CardDescription>Distribución activos vs inactivos</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={usageData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            outerRadius={100}
                            fill="hsl(var(--primary))"
                            dataKey="value"
                          >
                            {usageData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: "hsl(var(--popover))", 
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px"
                            }} 
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="details" className="space-y-4 mt-4">

                {/* Summary Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Métricas Detalladas</CardTitle>
                    <CardDescription>
                      Resumen del {timeRange === "daily" ? "día" : timeRange === "weekly" ? "semana" : "mes"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Usuarios</p>
                          <p className="text-2xl font-bold">{totalUsers}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Crecimiento</p>
                          <p className="text-2xl font-bold text-green-600 flex items-center gap-1">
                            <ArrowUp className="w-5 h-5" />
                            {userGrowth}%
                          </p>
                        </div>
                      </div>
                      
                      <div className="space-y-3 pt-4">
                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full">
                              <Wifi className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-sm font-medium">Conexiones Activas Ahora</span>
                          </div>
                          <span className="text-lg font-bold text-primary">{totalActiveConnections}</span>
                        </div>
                        
                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-chart-2/10 rounded-full">
                              <TrendingUp className="w-4 h-4 text-chart-2" />
                            </div>
                            <span className="text-sm font-medium">Tasa de Uso Promedio</span>
                          </div>
                          <span className="text-lg font-bold">{Math.round((totalActiveConnections / (totalUsers || 1)) * 100)}%</span>
                        </div>
                        
                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-chart-1/10 rounded-full">
                              <Activity className="w-4 h-4 text-chart-1" />
                            </div>
                            <span className="text-sm font-medium">Promedio Hotspot Activos</span>
                          </div>
                          <span className="text-lg font-bold">
                            {Math.round(historicalData.reduce((acc, d) => acc + d.hotspot, 0) / historicalData.length)}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-chart-3/10 rounded-full">
                              <Clock className="w-4 h-4 text-chart-3" />
                            </div>
                            <span className="text-sm font-medium">Promedio PPPoE Activos</span>
                          </div>
                          <span className="text-lg font-bold">
                            {Math.round(historicalData.reduce((acc, d) => acc + d.pppoe, 0) / historicalData.length)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-muted rounded-full">
                              <Users className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium">Pico de Conexiones</span>
                          </div>
                          <span className="text-lg font-bold">
                            {Math.max(...historicalData.map(d => d.total))}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-muted rounded-full">
                              <TrendingUp className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium">Conexiones Mínimas</span>
                          </div>
                          <span className="text-lg font-bold">
                            {Math.min(...historicalData.map(d => d.total))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
