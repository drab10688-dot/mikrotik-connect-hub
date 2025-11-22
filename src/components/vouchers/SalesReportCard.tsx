import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, ShoppingCart, Calendar } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";

interface Voucher {
  id: string;
  status: string;
  price: number | null;
  sold_at: string | null;
  created_at: string | null;
}

interface SalesReportCardProps {
  vouchers: Voucher[];
}

export function SalesReportCard({ vouchers }: SalesReportCardProps) {
  const soldVouchers = vouchers.filter(v => v.status === 'sold' && v.sold_at);

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { locale: es });
  const monthStart = startOfMonth(now);

  const todaySales = soldVouchers.filter(v => new Date(v.sold_at!) >= todayStart);
  const weekSales = soldVouchers.filter(v => new Date(v.sold_at!) >= weekStart);
  const monthSales = soldVouchers.filter(v => new Date(v.sold_at!) >= monthStart);

  const totalRevenue = soldVouchers.reduce((sum, v) => sum + (v.price || 0), 0);
  const todayRevenue = todaySales.reduce((sum, v) => sum + (v.price || 0), 0);
  const weekRevenue = weekSales.reduce((sum, v) => sum + (v.price || 0), 0);
  const monthRevenue = monthSales.reduce((sum, v) => sum + (v.price || 0), 0);

  const stats = [
    {
      title: "Ventas Hoy",
      value: `$${todayRevenue.toFixed(2)}`,
      count: todaySales.length,
      icon: Calendar,
      color: "text-blue-500",
    },
    {
      title: "Ventas Esta Semana",
      value: `$${weekRevenue.toFixed(2)}`,
      count: weekSales.length,
      icon: TrendingUp,
      color: "text-green-500",
    },
    {
      title: "Ventas Este Mes",
      value: `$${monthRevenue.toFixed(2)}`,
      count: monthSales.length,
      icon: ShoppingCart,
      color: "text-purple-500",
    },
    {
      title: "Total Vendido",
      value: `$${totalRevenue.toFixed(2)}`,
      count: soldVouchers.length,
      icon: DollarSign,
      color: "text-orange-500",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Ventas</CardTitle>
        <CardDescription>Resumen de ingresos por vouchers vendidos</CardDescription>
      </CardHeader>
      <CardContent>
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
                    {stat.count} voucher{stat.count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}