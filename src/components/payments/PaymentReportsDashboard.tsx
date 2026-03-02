import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoicesApi, transactionsApi, billingApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { DollarSign, Users, AlertTriangle, CheckCircle, Clock, Ban, FileDown, FileSpreadsheet, CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, eachMonthOfInterval, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import jsPDF from "jspdf";
import { toast } from "sonner";

interface PaymentReportsDashboardProps { mikrotikId: string | null; }

export function PaymentReportsDashboard({ mikrotikId }: PaymentReportsDashboardProps) {
  const [startDate, setStartDate] = useState<Date>(startOfYear(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [statusFilter, setStatusFilter] = useState<string[]>(['paid', 'pending', 'overdue']);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const dateRangeKey = `${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}`;

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ['payment-reports-invoices', mikrotikId, dateRangeKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return invoicesApi.list(mikrotikId, { start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd') });
    },
    enabled: !!mikrotikId,
  });

  const { data: transactions, isLoading: loadingTransactions } = useQuery({
    queryKey: ['payment-reports-transactions', mikrotikId, dateRangeKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return transactionsApi.list(mikrotikId, { status: 'approved', start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd') });
    },
    enabled: !!mikrotikId,
  });

  const { data: billingSettings, isLoading: loadingBilling } = useQuery({
    queryKey: ['payment-reports-billing', mikrotikId],
    queryFn: async () => { if (!mikrotikId) return []; return billingApi.listSettings(mikrotikId); },
    enabled: !!mikrotikId,
  });

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    setCurrentPage(1);
    return invoices.filter((inv: any) => statusFilter.includes(inv.status));
  }, [invoices, statusFilter]);

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredInvoices.slice(start, start + itemsPerPage);
  }, [filteredInvoices, currentPage, itemsPerPage]);

  const monthlyData = useMemo(() => {
    if (!filteredInvoices.length) return [];
    const monthsInRange = eachMonthOfInterval({ start: startDate, end: endDate });
    const months = monthsInRange.map(date => ({ month: format(date, 'MMM yy', { locale: es }), date, facturado: 0, cobrado: 0, pendiente: 0, vencido: 0 }));
    filteredInvoices.forEach((invoice: any) => {
      const invoiceDate = new Date(invoice.created_at);
      const monthEntry = months.find(m => isSameMonth(m.date, invoiceDate));
      if (monthEntry) {
        monthEntry.facturado += Number(invoice.amount);
        if (invoice.status === 'paid') monthEntry.cobrado += Number(invoice.amount);
        else if (invoice.status === 'pending') monthEntry.pendiente += Number(invoice.amount);
        else if (invoice.status === 'overdue') monthEntry.vencido += Number(invoice.amount);
      }
    });
    return months;
  }, [filteredInvoices, startDate, endDate]);

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

  const statusDistribution = useMemo(() => {
    if (!filteredInvoices.length) return [];
    const statusCount = filteredInvoices.reduce((acc: any, invoice: any) => { acc[invoice.status] = (acc[invoice.status] || 0) + 1; return acc; }, {});
    return [{ name: 'Pagadas', value: statusCount.paid || 0, color: 'hsl(var(--chart-2))' }, { name: 'Pendientes', value: statusCount.pending || 0, color: 'hsl(var(--chart-3))' }, { name: 'Vencidas', value: statusCount.overdue || 0, color: 'hsl(var(--chart-1))' }].filter(item => item.value > 0);
  }, [filteredInvoices]);

  const portfolioStatus = useMemo(() => {
    if (!billingSettings) return { active: 0, suspended: 0, totalMonthly: 0 };
    return billingSettings.reduce((acc: any, billing: any) => { if (billing.is_suspended) acc.suspended++; else acc.active++; acc.totalMonthly += Number(billing.monthly_amount); return acc; }, { active: 0, suspended: 0, totalMonthly: 0 });
  }, [billingSettings]);

  const collectionRate = summaryStats.total > 0 ? ((summaryStats.collected / summaryStats.total) * 100).toFixed(1) : '0';
  const dateRangeLabel = `${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`;

  const toggleStatusFilter = (status: string) => { setStatusFilter(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]); };

  const exportToExcel = () => {
    if (!invoices?.length) { toast.error("No hay datos"); return; }
    const headers = ["Número", "Fecha", "Monto", "Estado", "Vencimiento", "Pago", "Método"];
    const rows = invoices.map((inv: any) => [inv.invoice_number, format(new Date(inv.created_at), "dd/MM/yyyy"), inv.amount, inv.status === 'paid' ? 'Pagada' : inv.status === 'pending' ? 'Pendiente' : 'Vencida', format(new Date(inv.due_date), "dd/MM/yyyy"), inv.paid_at ? format(new Date(inv.paid_at), "dd/MM/yyyy") : '-', inv.paid_via || '-']);
    const csv = [`Reporte - ${dateRangeLabel}`, "", `Total: $${summaryStats.total.toLocaleString()}`, `Cobrado: $${summaryStats.collected.toLocaleString()}`, "", headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `reporte_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.csv`; link.click();
    toast.success("Exportado");
  };

  const exportToPDF = () => {
    if (!invoices?.length) { toast.error("No hay datos"); return; }
    const doc = new jsPDF(); const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(18); doc.text("Reporte de Facturación", pw/2, 20, { align: "center" });
    doc.setFontSize(12); doc.text(dateRangeLabel, pw/2, 28, { align: "center" });
    let y = 40;
    doc.text(`Total: $${summaryStats.total.toLocaleString()}`, 20, y);
    doc.text(`Cobrado: $${summaryStats.collected.toLocaleString()}`, 20, y+10);
    doc.text(`Pendiente: $${summaryStats.pending.toLocaleString()}`, 20, y+20);
    doc.text(`Tasa: ${collectionRate}%`, 20, y+30);
    doc.save(`reporte_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF exportado");
  };

  if (!mikrotikId) return (<Card><CardContent className="flex items-center justify-center h-64"><p className="text-muted-foreground">Selecciona un dispositivo MikroTik</p></CardContent></Card>);

  const isLoading = loadingInvoices || loadingTransactions || loadingBilling;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportToPDF} disabled={isLoading || !invoices?.length}><FileDown className="h-4 w-4 mr-2" />PDF</Button>
          <Button variant="outline" onClick={exportToExcel} disabled={isLoading || !invoices?.length}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Popover><PopoverTrigger asChild><Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4" />{format(startDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} className="p-3 pointer-events-auto" /></PopoverContent>
          </Popover>
          <span className="text-muted-foreground">a</span>
          <Popover><PopoverTrigger asChild><Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4" />{format(endDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={endDate} onSelect={(d) => d && setEndDate(d)} className="p-3 pointer-events-auto" /></PopoverContent>
          </Popover>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>Este mes</Button>
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>Este año</Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <span className="text-sm font-medium">Filtrar:</span>
        <div className="flex items-center gap-2"><Checkbox id="f-paid" checked={statusFilter.includes('paid')} onCheckedChange={() => toggleStatusFilter('paid')} /><Label htmlFor="f-paid" className="text-sm flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" />Pagadas</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="f-pending" checked={statusFilter.includes('pending')} onCheckedChange={() => toggleStatusFilter('pending')} /><Label htmlFor="f-pending" className="text-sm flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" />Pendientes</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="f-overdue" checked={statusFilter.includes('overdue')} onCheckedChange={() => toggleStatusFilter('overdue')} /><Label htmlFor="f-overdue" className="text-sm flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" />Vencidas</Label></div>
        <Badge variant="secondary" className="ml-auto">{filteredInvoices.length} facturas</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total Facturado</CardDescription><CardTitle className="text-2xl">${summaryStats.total.toLocaleString()}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Total Cobrado</CardDescription><CardTitle className="text-2xl text-green-600">${summaryStats.collected.toLocaleString()}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Pendiente</CardDescription><CardTitle className="text-2xl text-yellow-600">${summaryStats.pending.toLocaleString()}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Tasa de Cobro</CardDescription><CardTitle className="text-2xl">{collectionRate}%</CardTitle></CardHeader></Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Facturación Mensual</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[300px]" /> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Bar dataKey="cobrado" fill="hsl(var(--chart-2))" name="Cobrado" /><Bar dataKey="pendiente" fill="hsl(var(--chart-3))" name="Pendiente" /><Bar dataKey="vencido" fill="hsl(var(--chart-1))" name="Vencido" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Estado de Facturas</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[300px]" /> : statusDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart><Pie data={statusDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {statusDistribution.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie><Legend /></PieChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sin datos</div>}
          </CardContent>
        </Card>
      </div>

      {/* Portfolio */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Clientes Activos</CardDescription><CardTitle className="text-2xl flex items-center gap-2"><Users className="h-5 w-5 text-green-500" />{portfolioStatus.active}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Suspendidos</CardDescription><CardTitle className="text-2xl flex items-center gap-2"><Ban className="h-5 w-5 text-red-500" />{portfolioStatus.suspended}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Facturación Mensual</CardDescription><CardTitle className="text-2xl">${portfolioStatus.totalMonthly.toLocaleString()}</CardTitle></CardHeader></Card>
      </div>
    </div>
  );
}
