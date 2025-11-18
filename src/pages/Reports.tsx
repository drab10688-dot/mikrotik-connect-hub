import { useState, useRef } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, TrendingUp, Users, Wifi, Clock } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useHotspotActiveUsers, usePPPoEActive, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "@/hooks/use-toast";

type TimeRange = "daily" | "weekly" | "monthly";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

export default function Reports() {
  const [timeRange, setTimeRange] = useState<TimeRange>("daily");
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: hotspotActive } = useHotspotActiveUsers();
  const { data: pppoeActive } = usePPPoEActive();
  const { data: hotspotUsers } = useHotspotUsers();
  const { data: pppoeUsers } = usePPPoEUsers();

  const totalActiveConnections = (hotspotActive?.data?.length || 0) + (pppoeActive?.data?.length || 0);
  const totalHotspotUsers = hotspotUsers?.data?.length || 0;
  const totalPPPoEUsers = pppoeUsers?.data?.length || 0;
  const totalUsers = totalHotspotUsers + totalPPPoEUsers;

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
      <div className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reportes y Estadísticas</h1>
              <p className="text-muted-foreground mt-2">
                Análisis detallado de conexiones y uso de red
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Select value={timeRange} onValueChange={(value: TimeRange) => setTimeRange(value)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Últimas 24 horas</SelectItem>
                  <SelectItem value="weekly">Última semana</SelectItem>
                  <SelectItem value="monthly">Último mes</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={exportToPDF} className="gap-2">
                <Download className="w-4 h-4" />
                Exportar PDF
              </Button>
            </div>
          </div>

          <div ref={reportRef} className="space-y-8 bg-background p-6 rounded-lg">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Conexiones Activas</CardTitle>
                  <Wifi className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalActiveConnections}</div>
                  <p className="text-xs text-muted-foreground">
                    {Math.round((totalActiveConnections / totalUsers) * 100)}% de usuarios conectados
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Usuarios</CardTitle>
                  <Users className="h-4 w-4 text-secondary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalUsers}</div>
                  <p className="text-xs text-muted-foreground">
                    {totalHotspotUsers} Hotspot + {totalPPPoEUsers} PPPoE
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Usuarios Hotspot</CardTitle>
                  <TrendingUp className="h-4 w-4 text-accent" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalHotspotUsers}</div>
                  <p className="text-xs text-muted-foreground">
                    {hotspotActive?.data?.length || 0} activos ahora
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Usuarios PPPoE</CardTitle>
                  <Clock className="h-4 w-4 text-muted" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalPPPoEUsers}</div>
                  <p className="text-xs text-muted-foreground">
                    {pppoeActive?.data?.length || 0} activos ahora
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Historical Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Conexiones Activas en el Tiempo</CardTitle>
                <CardDescription>
                  Histórico de conexiones {timeRange === "daily" ? "por hora" : timeRange === "weekly" ? "diarias" : "mensuales"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={historicalData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--background))", 
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px"
                      }} 
                    />
                    <Legend />
                    <Line type="monotone" dataKey="hotspot" stroke="hsl(var(--primary))" strokeWidth={2} name="Hotspot" />
                    <Line type="monotone" dataKey="pppoe" stroke="hsl(var(--secondary))" strokeWidth={2} name="PPPoE" />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--accent))" strokeWidth={2} name="Total" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Connection Type Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Distribución por Tipo de Conexión</CardTitle>
                  <CardDescription>Usuarios registrados vs activos</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={connectionTypeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                      <YAxis stroke="hsl(var(--muted-foreground))" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--background))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }} 
                      />
                      <Legend />
                      <Bar dataKey="value" fill="hsl(var(--primary))" name="Total Usuarios" />
                      <Bar dataKey="active" fill="hsl(var(--accent))" name="Activos" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Usage Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Estado de Usuarios</CardTitle>
                  <CardDescription>Activos vs Inactivos</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={usageData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
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
                          backgroundColor: "hsl(var(--background))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px"
                        }} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Summary Table */}
            <Card>
              <CardHeader>
                <CardTitle>Resumen del Período</CardTitle>
                <CardDescription>Métricas clave del {timeRange === "daily" ? "día" : timeRange === "weekly" ? "semana" : "mes"}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-sm font-medium">Total de Usuarios Registrados</span>
                    <span className="text-lg font-bold">{totalUsers}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-sm font-medium">Conexiones Activas Ahora</span>
                    <span className="text-lg font-bold text-primary">{totalActiveConnections}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-sm font-medium">Tasa de Uso</span>
                    <span className="text-lg font-bold">{Math.round((totalActiveConnections / totalUsers) * 100)}%</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-sm font-medium">Promedio Hotspot Activos</span>
                    <span className="text-lg font-bold">
                      {Math.round(historicalData.reduce((acc, d) => acc + d.hotspot, 0) / historicalData.length)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Promedio PPPoE Activos</span>
                    <span className="text-lg font-bold">
                      {Math.round(historicalData.reduce((acc, d) => acc + d.pppoe, 0) / historicalData.length)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
