import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DollarSign, TrendingUp, ShoppingCart, Calendar, Clock, Download, Wifi } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear, endOfDay, endOfWeek, endOfMonth, endOfYear, subDays, subMonths } from "date-fns";
import { es } from "date-fns/locale";

interface Voucher {
  id: string;
  status: string;
  price: number | null;
  sold_at: string | null;
  created_at: string | null;
  profile: string;
  code?: string;
  uptime?: string;
}

interface VoucherReportsProps {
  vouchers: Voucher[];
}

export function VoucherReports({ vouchers }: VoucherReportsProps) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  
  // Incluir vouchers vendidos Y usados (conectados)
  const soldOrUsedVouchers = vouchers.filter(v => (v.status === 'sold' || v.status === 'used') && (v.sold_at || v.status === 'used'));
  const usedVouchers = vouchers.filter(v => v.status === 'used');
  const now = new Date();

  // Funciones para obtener rangos de fechas
  const getDateRange = (period: string) => {
    switch (period) {
      case 'day':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { locale: es }), end: endOfWeek(now, { locale: es }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const { start, end } = getDateRange(period);

  // Filtrar ventas por período
  const periodSales = soldOrUsedVouchers.filter(v => {
    if (v.sold_at) {
      const saleDate = new Date(v.sold_at);
      return saleDate >= start && saleDate <= end;
    }
    // Para vouchers usados sin sold_at, usar created_at
    if (v.created_at) {
      const createdDate = new Date(v.created_at);
      return createdDate >= start && createdDate <= end;
    }
    return false;
  });

  const periodUsed = periodSales.filter(v => v.status === 'used');
  const periodRevenue = periodSales.reduce((sum, v) => sum + (v.price || 0), 0);
  const avgTicket = periodSales.length > 0 ? periodRevenue / periodSales.length : 0;

  // Ventas por perfil
  const salesByProfile = periodSales.reduce((acc, v) => {
    acc[v.profile] = (acc[v.profile] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Comparación con período anterior
  const getPreviousPeriodRange = () => {
    switch (period) {
      case 'day':
        return { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) };
      case 'week':
        return { start: startOfWeek(subDays(now, 7), { locale: es }), end: endOfWeek(subDays(now, 7), { locale: es }) };
      case 'month':
        return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
      case 'year':
        return { start: startOfYear(subMonths(now, 12)), end: endOfYear(subMonths(now, 12)) };
      default:
        return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    }
  };

  const prevRange = getPreviousPeriodRange();
  const prevPeriodSales = soldOrUsedVouchers.filter(v => {
    if (v.sold_at) {
      const saleDate = new Date(v.sold_at);
      return saleDate >= prevRange.start && saleDate <= prevRange.end;
    }
    if (v.created_at) {
      const createdDate = new Date(v.created_at);
      return createdDate >= prevRange.start && createdDate <= prevRange.end;
    }
    return false;
  });
  const prevRevenue = prevPeriodSales.reduce((sum, v) => sum + (v.price || 0), 0);
  const growth = prevRevenue > 0 ? ((periodRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  const getPeriodLabel = () => {
    switch (period) {
      case 'day':
        return `Hoy - ${format(now, 'dd MMM yyyy', { locale: es })}`;
      case 'week':
        return `Esta Semana - ${format(start, 'dd MMM', { locale: es })} al ${format(end, 'dd MMM', { locale: es })}`;
      case 'month':
        return `Este Mes - ${format(now, 'MMMM yyyy', { locale: es })}`;
      case 'year':
        return `Este Año - ${format(now, 'yyyy', { locale: es })}`;
      default:
        return '';
    }
  };

  const downloadCSV = () => {
    const headers = ['Código', 'Perfil', 'Precio', 'Estado', 'Fecha Venta', 'Tiempo Usado'];
    const rows = periodSales.map(v => [
      v.code || 'N/A',
      v.profile,
      v.price?.toFixed(2) || '0.00',
      v.status === 'used' ? 'Conectado' : 'Vendido',
      v.sold_at ? format(new Date(v.sold_at), 'dd/MM/yyyy HH:mm', { locale: es }) : 'N/A',
      v.uptime || 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `reporte-ventas-${format(now, 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const stats = [
    {
      title: "Ingresos Totales",
      value: `$${periodRevenue.toFixed(2)}`,
      icon: DollarSign,
      color: "text-green-500",
      subtext: `${periodSales.length} vouchers vendidos`,
    },
    {
      title: "Conectados",
      value: periodUsed.length.toString(),
      icon: Wifi,
      color: "text-blue-500",
      subtext: "vouchers en uso",
    },
    {
      title: "Crecimiento",
      value: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
      icon: TrendingUp,
      color: growth >= 0 ? "text-green-500" : "text-red-500",
      subtext: "vs período anterior",
    },
    {
      title: "Ticket Promedio",
      value: `$${avgTicket.toFixed(2)}`,
      icon: ShoppingCart,
      color: "text-purple-500",
      subtext: "por voucher",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle>Reportes de Ventas</CardTitle>
            <CardDescription>{getPeriodLabel()}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadCSV} disabled={periodSales.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
            <Select value={period} onValueChange={(value: any) => setPeriod(value)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Hoy</SelectItem>
                <SelectItem value="week">Esta Semana</SelectItem>
                <SelectItem value="month">Este Mes</SelectItem>
                <SelectItem value="year">Este Año</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="profiles">Por Perfil</TabsTrigger>
            <TabsTrigger value="connected">Conectados</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.title}
                    className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        {stat.title}
                      </span>
                      <Icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">
                        {stat.subtext}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="profiles" className="space-y-4">
            {Object.keys(salesByProfile).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(salesByProfile)
                  .sort(([, a], [, b]) => b - a)
                  .map(([profile, count]) => {
                    const profileRevenue = periodSales
                      .filter(v => v.profile === profile)
                      .reduce((sum, v) => sum + (v.price || 0), 0);
                    const profileUsed = periodSales.filter(v => v.profile === profile && v.status === 'used').length;
                    
                    return (
                      <div
                        key={profile}
                        className="p-4 rounded-lg border bg-card"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold">{profile}</span>
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xl font-bold">{count} ventas</div>
                          <div className="text-sm text-muted-foreground">
                            ${profileRevenue.toFixed(2)} en ingresos
                          </div>
                          {profileUsed > 0 && (
                            <div className="text-xs text-green-500">
                              {profileUsed} conectados
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No hay datos de ventas para este período
              </div>
            )}
          </TabsContent>

          <TabsContent value="connected" className="space-y-4">
            {periodUsed.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground mb-4">
                  Vouchers que se han conectado por primera vez
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {periodUsed.map((voucher) => (
                    <div
                      key={voucher.id}
                      className="p-3 rounded-lg border bg-card flex items-center justify-between"
                    >
                      <div>
                        <div className="font-mono text-sm font-medium">{voucher.code}</div>
                        <div className="text-xs text-muted-foreground">{voucher.profile}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-green-500">{voucher.uptime || 'Activo'}</div>
                        <div className="text-xs text-muted-foreground">${voucher.price?.toFixed(2) || '0.00'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No hay vouchers conectados en este período
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
