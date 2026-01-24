import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { 
  DollarSign, 
  Users, 
  AlertTriangle, 
  CheckCircle,
  Clock,
  Ban,
  FileDown,
  FileSpreadsheet,
  CalendarIcon,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, eachMonthOfInterval, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import jsPDF from "jspdf";
import { toast } from "sonner";

interface PaymentReportsDashboardProps {
  mikrotikId: string | null;
}

export function PaymentReportsDashboard({ mikrotikId }: PaymentReportsDashboardProps) {
  const [startDate, setStartDate] = useState<Date>(startOfYear(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [statusFilter, setStatusFilter] = useState<string[]>(['paid', 'pending', 'overdue']);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const dateRangeKey = `${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}`;

  // Fetch invoices for reports
  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ['payment-reports-invoices', mikrotikId, dateRangeKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .gte('created_at', format(startDate, 'yyyy-MM-dd'))
        .lte('created_at', format(endDate, 'yyyy-MM-dd'))
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch transactions for payment method breakdown
  const { data: transactions, isLoading: loadingTransactions } = useQuery({
    queryKey: ['payment-reports-transactions', mikrotikId, dateRangeKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .eq('status', 'approved')
        .gte('created_at', format(startDate, 'yyyy-MM-dd'))
        .lte('created_at', format(endDate, 'yyyy-MM-dd'));
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch billing settings for portfolio status
  const { data: billingSettings, isLoading: loadingBilling } = useQuery({
    queryKey: ['payment-reports-billing', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from('client_billing_settings')
        .select(`
          *,
          isp_clients!client_billing_settings_client_id_fkey (
            client_name,
            username
          )
        `)
        .eq('mikrotik_id', mikrotikId);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Filter invoices by status
  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    setCurrentPage(1); // Reset page when filters change
    return invoices.filter((inv: any) => statusFilter.includes(inv.status));
  }, [invoices, statusFilter]);

  // Paginated invoices for table display
  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredInvoices.slice(start, start + itemsPerPage);
  }, [filteredInvoices, currentPage, itemsPerPage]);

  // Calculate monthly revenue data based on date range
  const monthlyData = useMemo(() => {
    if (!filteredInvoices.length) return [];
    
    // Get all months in the date range
    const monthsInRange = eachMonthOfInterval({ start: startDate, end: endDate });
    
    const months = monthsInRange.map(date => ({
      month: format(date, 'MMM yy', { locale: es }),
      date,
      facturado: 0,
      cobrado: 0,
      pendiente: 0,
      vencido: 0
    }));

    filteredInvoices.forEach((invoice: any) => {
      const invoiceDate = new Date(invoice.created_at);
      const monthEntry = months.find(m => isSameMonth(m.date, invoiceDate));
      
      if (monthEntry) {
        monthEntry.facturado += Number(invoice.amount);
        
        if (invoice.status === 'paid') {
          monthEntry.cobrado += Number(invoice.amount);
        } else if (invoice.status === 'pending') {
          monthEntry.pendiente += Number(invoice.amount);
        } else if (invoice.status === 'overdue') {
          monthEntry.vencido += Number(invoice.amount);
        }
      }
    });

    return months;
  }, [filteredInvoices, startDate, endDate]);

  // Calculate summary stats based on filtered invoices
  const summaryStats = useMemo(() => {
    if (!filteredInvoices.length) return { total: 0, collected: 0, pending: 0, overdue: 0 };
    
    return filteredInvoices.reduce((acc: any, invoice: any) => {
      acc.total += Number(invoice.amount);
      if (invoice.status === 'paid') acc.collected += Number(invoice.amount);
      else if (invoice.status === 'pending') acc.pending += Number(invoice.amount);
      else if (invoice.status === 'overdue') acc.overdue += Number(invoice.amount);
      return acc;
    }, { total: 0, collected: 0, pending: 0, overdue: 0 });
  }, [filteredInvoices]);

  // Invoice status distribution for pie chart
  const statusDistribution = useMemo(() => {
    if (!filteredInvoices.length) return [];
    
    const statusCount = filteredInvoices.reduce((acc: any, invoice: any) => {
      acc[invoice.status] = (acc[invoice.status] || 0) + 1;
      return acc;
    }, {});

    return [
      { name: 'Pagadas', value: statusCount.paid || 0, color: 'hsl(var(--chart-2))' },
      { name: 'Pendientes', value: statusCount.pending || 0, color: 'hsl(var(--chart-3))' },
      { name: 'Vencidas', value: statusCount.overdue || 0, color: 'hsl(var(--chart-1))' },
    ].filter(item => item.value > 0);
  }, [filteredInvoices]);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  // Payment method breakdown
  const paymentMethodData = useMemo(() => {
    if (!transactions) return [];
    
    const methodCount = transactions.reduce((acc: any, tx: any) => {
      const platform = tx.platform === 'wompi' ? 'Wompi' : 
                       tx.platform === 'mercadopago' ? 'Mercado Pago' : 
                       tx.platform || 'Otro';
      acc[platform] = (acc[platform] || 0) + Number(tx.amount);
      return acc;
    }, {});

    return Object.entries(methodCount).map(([name, value]) => ({
      name,
      value: value as number,
      color: name === 'Wompi' ? 'hsl(var(--chart-4))' : 'hsl(var(--chart-5))'
    }));
  }, [transactions]);

  // Portfolio status
  const portfolioStatus = useMemo(() => {
    if (!billingSettings) return { active: 0, suspended: 0, totalMonthly: 0 };
    
    return billingSettings.reduce((acc: any, billing: any) => {
      if (billing.is_suspended) acc.suspended++;
      else acc.active++;
      acc.totalMonthly += Number(billing.monthly_amount);
      return acc;
    }, { active: 0, suspended: 0, totalMonthly: 0 });
  }, [billingSettings]);

  const collectionRate = summaryStats.total > 0 
    ? ((summaryStats.collected / summaryStats.total) * 100).toFixed(1)
    : '0';

  const dateRangeLabel = `${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`;

  // Export to Excel (CSV format)
  const exportToExcel = () => {
    if (!invoices || invoices.length === 0) {
      toast.error("No hay datos para exportar");
      return;
    }

    const headers = ["Número Factura", "Fecha", "Monto", "Estado", "Fecha Vencimiento", "Fecha Pago", "Método Pago"];
    const rows = invoices.map((inv: any) => [
      inv.invoice_number,
      format(new Date(inv.created_at), "dd/MM/yyyy"),
      inv.amount,
      inv.status === 'paid' ? 'Pagada' : inv.status === 'pending' ? 'Pendiente' : 'Vencida',
      format(new Date(inv.due_date), "dd/MM/yyyy"),
      inv.paid_at ? format(new Date(inv.paid_at), "dd/MM/yyyy") : '-',
      inv.paid_via || '-'
    ]);

    const csvContent = [
      `Reporte de Facturación - ${dateRangeLabel}`,
      "",
      `Total Facturado: $${summaryStats.total.toLocaleString()}`,
      `Total Recaudado: $${summaryStats.collected.toLocaleString()}`,
      `Total Pendiente: $${summaryStats.pending.toLocaleString()}`,
      `Total Vencido: $${summaryStats.overdue.toLocaleString()}`,
      `Tasa de Cobro: ${collectionRate}%`,
      "",
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte_facturacion_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Archivo Excel exportado correctamente");
  };

  // Export to PDF
  const exportToPDF = () => {
    if (!invoices || invoices.length === 0) {
      toast.error("No hay datos para exportar");
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Title
    doc.setFontSize(18);
    doc.text(`Reporte de Facturación`, pageWidth / 2, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text(dateRangeLabel, pageWidth / 2, 28, { align: "center" });
    
    // Summary
    doc.setFontSize(12);
    let y = 40;
    doc.text(`Total Facturado: $${summaryStats.total.toLocaleString()}`, 20, y);
    doc.text(`Total Recaudado: $${summaryStats.collected.toLocaleString()}`, 20, y + 10);
    doc.text(`Total Pendiente: $${summaryStats.pending.toLocaleString()}`, 20, y + 20);
    doc.text(`Total Vencido: $${summaryStats.overdue.toLocaleString()}`, 20, y + 30);
    doc.text(`Tasa de Cobro: ${collectionRate}%`, 20, y + 40);

    // Monthly breakdown
    y = 100;
    doc.setFontSize(14);
    doc.text("Desglose Mensual", 20, y);
    
    doc.setFontSize(10);
    y += 10;
    doc.text("Mes", 20, y);
    doc.text("Facturado", 50, y);
    doc.text("Cobrado", 90, y);
    doc.text("Pendiente", 130, y);
    doc.text("Vencido", 170, y);
    
    y += 5;
    doc.line(20, y, 190, y);
    y += 5;

    monthlyData.forEach((month: any) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(month.month, 20, y);
      doc.text(`$${month.facturado.toLocaleString()}`, 50, y);
      doc.text(`$${month.cobrado.toLocaleString()}`, 90, y);
      doc.text(`$${month.pendiente.toLocaleString()}`, 130, y);
      doc.text(`$${month.vencido.toLocaleString()}`, 170, y);
      y += 8;
    });

    // Portfolio status
    if (y > 230) {
      doc.addPage();
      y = 20;
    } else {
      y += 20;
    }
    doc.setFontSize(14);
    doc.text("Estado de Cartera", 20, y);
    doc.setFontSize(10);
    y += 10;
    doc.text(`Clientes Activos: ${portfolioStatus.active}`, 20, y);
    doc.text(`Clientes Suspendidos: ${portfolioStatus.suspended}`, 20, y + 8);
    doc.text(`Facturación Mensual Esperada: $${portfolioStatus.totalMonthly.toLocaleString()}`, 20, y + 16);

    // Footer
    doc.setFontSize(8);
    doc.text(`Generado el ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageWidth / 2, 285, { align: "center" });

    doc.save(`reporte_facturacion_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF exportado correctamente");
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Selecciona un dispositivo MikroTik para ver los reportes
          </p>
        </CardContent>
      </Card>
    );
  }

  const isLoading = loadingInvoices || loadingTransactions || loadingBilling;

  return (
    <div className="space-y-6">
      {/* Date range filters and export buttons */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportToPDF} disabled={isLoading || !invoices?.length}>
            <FileDown className="h-4 w-4 mr-2" />
            Exportar PDF
          </Button>
          <Button variant="outline" onClick={exportToExcel} disabled={isLoading || !invoices?.length}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "dd/MM/yyyy") : "Fecha inicio"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={(date) => date && setStartDate(date)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground">a</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "dd/MM/yyyy") : "Fecha fin"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={(date) => date && setEndDate(date)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>
              Este mes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>
              Este año
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(subMonths(startOfMonth(new Date()), 2)); setEndDate(endOfMonth(new Date())); }}>
              Últimos 3 meses
            </Button>
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <span className="text-sm font-medium">Filtrar por estado:</span>
        <div className="flex items-center gap-2">
          <Checkbox 
            id="filter-paid" 
            checked={statusFilter.includes('paid')}
            onCheckedChange={() => toggleStatusFilter('paid')}
          />
          <Label htmlFor="filter-paid" className="text-sm flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            Pagadas
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox 
            id="filter-pending" 
            checked={statusFilter.includes('pending')}
            onCheckedChange={() => toggleStatusFilter('pending')}
          />
          <Label htmlFor="filter-pending" className="text-sm flex items-center gap-1">
            <Clock className="h-3 w-3 text-yellow-500" />
            Pendientes
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox 
            id="filter-overdue" 
            checked={statusFilter.includes('overdue')}
            onCheckedChange={() => toggleStatusFilter('overdue')}
          />
          <Label htmlFor="filter-overdue" className="text-sm flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-red-500" />
            Vencidas
          </Label>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {filteredInvoices.length} facturas
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  ${summaryStats.total.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {dateRangeLabel}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recaudado</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-600">
                  ${summaryStats.collected.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Tasa de cobro: {collectionRate}%
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendiente</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold text-yellow-600">
                  ${summaryStats.pending.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Por cobrar
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencido</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold text-red-600">
                  ${summaryStats.overdue.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Cartera morosa
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Monthly Revenue Chart */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Recaudación Mensual</CardTitle>
            <CardDescription>Comparativa de facturación vs cobros por mes</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <defs>
                    <linearGradient id="gradientFacturado" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={1}/>
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.7}/>
                    </linearGradient>
                    <linearGradient id="gradientCobrado" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={1}/>
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={{ stroke: 'hsl(var(--border))' }}
                    tickFormatter={(value) => `$${value.toLocaleString()}`} 
                  />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                    labelFormatter={(label) => `Mes: ${label}`}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    formatter={(value) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>}
                  />
                  <Bar dataKey="facturado" name="Facturado" fill="url(#gradientFacturado)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="cobrado" name="Cobrado" fill="url(#gradientCobrado)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Invoice Status Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Estado de Facturas</CardTitle>
            <CardDescription>Distribución por estado</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : statusDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <defs>
                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/>
                    </filter>
                  </defs>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }}
                    style={{ filter: 'url(#shadow)' }}
                  >
                    {statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [value, 'Facturas']}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No hay datos de facturas
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Methods Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Métodos de Pago</CardTitle>
            <CardDescription>Recaudo por plataforma</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : paymentMethodData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={paymentMethodData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
                    labelLine={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }}
                  >
                    {paymentMethodData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => `$${value.toLocaleString()}`}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No hay transacciones registradas
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Portfolio Status */}
      <Card>
        <CardHeader>
          <CardTitle>Estado de Cartera</CardTitle>
          <CardDescription>Resumen de clientes y facturación mensual</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-green-50 dark:bg-green-950/20">
                <Users className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-2xl font-bold text-green-600">{portfolioStatus.active}</p>
                  <p className="text-sm text-muted-foreground">Clientes Activos</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
                <Ban className="h-8 w-8 text-red-600" />
                <div>
                  <p className="text-2xl font-bold text-red-600">{portfolioStatus.suspended}</p>
                  <p className="text-sm text-muted-foreground">Clientes Suspendidos</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                <DollarSign className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold text-blue-600">
                    ${portfolioStatus.totalMonthly.toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">Facturación Mensual Esperada</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle de Facturas</CardTitle>
          <CardDescription>
            Listado de {filteredInvoices.length} facturas en el período seleccionado
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : filteredInvoices.length > 0 ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium">N° Factura</th>
                      <th className="text-left py-3 px-2 font-medium">Fecha</th>
                      <th className="text-right py-3 px-2 font-medium">Monto</th>
                      <th className="text-center py-3 px-2 font-medium">Estado</th>
                      <th className="text-left py-3 px-2 font-medium">Vencimiento</th>
                      <th className="text-left py-3 px-2 font-medium">Pago</th>
                      <th className="text-left py-3 px-2 font-medium">Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInvoices.map((invoice: any) => (
                      <tr key={invoice.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-2 font-mono text-xs">{invoice.invoice_number}</td>
                        <td className="py-3 px-2">{format(new Date(invoice.created_at), 'dd/MM/yyyy')}</td>
                        <td className="py-3 px-2 text-right font-medium">${Number(invoice.amount).toLocaleString()}</td>
                        <td className="py-3 px-2 text-center">
                          <Badge 
                            variant={
                              invoice.status === 'paid' ? 'default' : 
                              invoice.status === 'pending' ? 'secondary' : 
                              'destructive'
                            }
                            className={
                              invoice.status === 'paid' ? 'bg-green-500 hover:bg-green-600' : ''
                            }
                          >
                            {invoice.status === 'paid' ? 'Pagada' : 
                             invoice.status === 'pending' ? 'Pendiente' : 
                             'Vencida'}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">{format(new Date(invoice.due_date), 'dd/MM/yyyy')}</td>
                        <td className="py-3 px-2">
                          {invoice.paid_at ? format(new Date(invoice.paid_at), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td className="py-3 px-2">{invoice.paid_via || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, filteredInvoices.length)} de {filteredInvoices.length} facturas
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setCurrentPage(pageNum)}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay facturas que coincidan con los filtros seleccionados
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspended Clients List */}
      {billingSettings && billingSettings.filter((b: any) => b.is_suspended).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Clientes Suspendidos
            </CardTitle>
            <CardDescription>Lista de clientes con servicio suspendido por mora</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {billingSettings
                .filter((b: any) => b.is_suspended)
                .map((billing: any) => (
                  <div 
                    key={billing.id} 
                    className="flex items-center justify-between p-3 rounded-lg border bg-red-50 dark:bg-red-950/20"
                  >
                    <div>
                      <p className="font-medium">
                        {billing.isp_clients?.client_name || 'Cliente sin nombre'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Usuario: {billing.isp_clients?.username || 'N/A'}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="destructive">Suspendido</Badge>
                      {billing.suspended_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Desde: {format(new Date(billing.suspended_at), 'dd/MM/yyyy', { locale: es })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
