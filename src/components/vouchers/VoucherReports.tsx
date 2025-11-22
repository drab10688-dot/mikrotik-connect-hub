import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, TrendingUp, ShoppingCart, Calendar, Clock } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear, endOfDay, endOfWeek, endOfMonth, endOfYear, subDays, subMonths } from "date-fns";
import { es } from "date-fns/locale";

interface Voucher {
  id: string;
  status: string;
  price: number | null;
  sold_at: string | null;
  created_at: string | null;
  profile: string;
}

interface VoucherReportsProps {
  vouchers: Voucher[];
}

export function VoucherReports({ vouchers }: VoucherReportsProps) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  
  const soldVouchers = vouchers.filter(v => v.status === 'sold' && v.sold_at);
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
  const periodSales = soldVouchers.filter(v => {
    const saleDate = new Date(v.sold_at!);
    return saleDate >= start && saleDate <= end;
  });

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
  const prevPeriodSales = soldVouchers.filter(v => {
    const saleDate = new Date(v.sold_at!);
    return saleDate >= prevRange.start && saleDate <= prevRange.end;
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

  const stats = [
    {
      title: "Ingresos Totales",
      value: `$${periodRevenue.toFixed(2)}`,
      icon: DollarSign,
      color: "text-green-500",
      subtext: `${periodSales.length} vouchers vendidos`,
    },
    {
      title: "Ticket Promedio",
      value: `$${avgTicket.toFixed(2)}`,
      icon: ShoppingCart,
      color: "text-blue-500",
      subtext: "Por voucher vendido",
    },
    {
      title: "Crecimiento",
      value: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
      icon: TrendingUp,
      color: growth >= 0 ? "text-green-500" : "text-red-500",
      subtext: "vs período anterior",
    },
    {
      title: "Período",
      value: periodSales.length.toString(),
      icon: Calendar,
      color: "text-purple-500",
      subtext: "ventas en el período",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Reportes de Ventas</CardTitle>
            <CardDescription>{getPeriodLabel()}</CardDescription>
          </div>
          <Select value={period} onValueChange={(value: any) => setPeriod(value)}>
            <SelectTrigger className="w-[180px]">
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
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="profiles">Por Perfil</TabsTrigger>
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
        </Tabs>
      </CardContent>
    </Card>
  );
}
