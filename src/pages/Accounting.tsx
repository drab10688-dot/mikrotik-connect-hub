import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Users, FileDown,
  FileSpreadsheet, CalendarIcon, ArrowUpRight, ArrowDownRight,
  Receipt, ShoppingCart, CreditCard, Banknote, PiggyBank
} from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, eachMonthOfInterval, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { toast } from "sonner";
import jsPDF from "jspdf";

export default function Accounting() {
  const mikrotikId = getSelectedDeviceId();
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [activeTab, setActiveTab] = useState("balance");

  const dateKey = `${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}`;

  // Fetch paid invoices (ISP income)
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['accounting-invoices', mikrotikId, dateKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*, isp_clients!client_invoices_client_id_fkey(client_name)')
        .eq('mikrotik_id', mikrotikId)
        .gte('created_at', format(startDate, 'yyyy-MM-dd'))
        .lte('created_at', format(endDate, 'yyyy-MM-dd'))
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch voucher sales (Hotspot income)
  const { data: voucherSales = [], isLoading: loadingVouchers } = useQuery({
    queryKey: ['accounting-voucher-sales', mikrotikId, dateKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('voucher_sales_history')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .gte('sold_at', format(startDate, 'yyyy-MM-dd'))
        .lte('sold_at', format(endDate, 'yyyy-MM-dd'))
        .order('sold_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch active voucher sales from inventory
  const { data: activeVoucherSales = [] } = useQuery({
    queryKey: ['accounting-active-vouchers', mikrotikId, dateKey],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('vouchers')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .eq('status', 'sold')
        .gte('sold_at', format(startDate, 'yyyy-MM-dd'))
        .lte('sold_at', format(endDate, 'yyyy-MM-dd'));
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch reseller assignments with profiles
  const { data: resellers = [] } = useQuery({
    queryKey: ['accounting-resellers', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('reseller_assignments')
        .select('*')
        .eq('mikrotik_id', mikrotikId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch reseller profiles
  const { data: resellerProfiles = [] } = useQuery({
    queryKey: ['accounting-reseller-profiles', resellers],
    queryFn: async () => {
      if (!resellers.length) return [];
      const resellerIds = resellers.map((r: any) => r.reseller_id);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', resellerIds);
      if (error) throw error;
      return data || [];
    },
    enabled: resellers.length > 0,
  });

  // Fetch payment transactions
  const { data: transactions = [] } = useQuery({
    queryKey: ['accounting-transactions', mikrotikId, dateKey],
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

  // Calculate balance
  const balance = useMemo(() => {
    const paidInvoices = invoices.filter((i: any) => i.status === 'paid');
    const ispIncome = paidInvoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
    
    const allVoucherSales = [...voucherSales, ...activeVoucherSales];
    const voucherIncome = allVoucherSales.reduce((sum: number, v: any) => sum + Number(v.price || 0), 0);
    
    const onlinePayments = transactions.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
    
    const pendingInvoices = invoices.filter((i: any) => i.status === 'pending');
    const pendingAmount = pendingInvoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
    
    const overdueInvoices = invoices.filter((i: any) => i.status === 'overdue');
    const overdueAmount = overdueInvoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0);

    const totalIncome = ispIncome + voucherIncome;
    
    return {
      totalIncome,
      ispIncome,
      voucherIncome,
      onlinePayments,
      cashPayments: ispIncome - onlinePayments,
      pendingAmount,
      overdueAmount,
      paidCount: paidInvoices.length,
      pendingCount: pendingInvoices.length,
      overdueCount: overdueInvoices.length,
      voucherCount: allVoucherSales.length,
    };
  }, [invoices, voucherSales, activeVoucherSales, transactions]);

  // Monthly chart data
  const monthlyData = useMemo(() => {
    const months = eachMonthOfInterval({ start: startDate, end: endDate });
    return months.map(date => {
      const monthInvoices = invoices.filter((i: any) => i.status === 'paid' && isSameMonth(new Date(i.paid_at || i.created_at), date));
      const monthVouchers = [...voucherSales, ...activeVoucherSales].filter((v: any) => isSameMonth(new Date(v.sold_at), date));
      
      return {
        month: format(date, 'MMM', { locale: es }),
        isp: monthInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0),
        vouchers: monthVouchers.reduce((s: number, v: any) => s + Number(v.price || 0), 0),
      };
    });
  }, [invoices, voucherSales, activeVoucherSales, startDate, endDate]);

  // Income distribution
  const incomeDistribution = useMemo(() => [
    { name: 'ISP (Mensualidades)', value: balance.ispIncome, color: 'hsl(var(--chart-1))' },
    { name: 'Vouchers', value: balance.voucherIncome, color: 'hsl(var(--chart-2))' },
  ].filter(i => i.value > 0), [balance]);

  // Payment method distribution
  const paymentMethodData = useMemo(() => [
    { name: 'Efectivo', value: Math.max(0, balance.cashPayments), color: 'hsl(var(--chart-3))' },
    { name: 'En línea', value: balance.onlinePayments, color: 'hsl(var(--chart-4))' },
  ].filter(i => i.value > 0), [balance]);

  // Reseller report data
  const resellerReport = useMemo(() => {
    const allSales = [...voucherSales, ...activeVoucherSales];
    
    return resellers.map((r: any) => {
      const sales = allSales.filter((v: any) => v.sold_by === r.reseller_id);
      const totalSales = sales.reduce((s: number, v: any) => s + Number(v.price || 0), 0);
      const commission = totalSales * (Number(r.commission_percentage) / 100);
      const profile = resellerProfiles.find((p: any) => p.user_id === r.reseller_id);
      
      return {
        id: r.id,
        name: profile?.full_name || profile?.email || 'Sin nombre',
        email: profile?.email || '',
        salesCount: sales.length,
        totalSales,
        commissionRate: Number(r.commission_percentage),
        commission,
        netIncome: totalSales - commission,
      };
    });
  }, [resellers, voucherSales, activeVoucherSales, resellerProfiles]);

  // Recent movements (combined)
  const recentMovements = useMemo(() => {
    const movements: any[] = [];
    
    invoices.filter((i: any) => i.status === 'paid').slice(0, 15).forEach((i: any) => {
      movements.push({
        date: i.paid_at || i.created_at,
        type: 'isp',
        description: `Pago factura ${i.invoice_number}`,
        client: (i as any).isp_clients?.client_name || '-',
        amount: Number(i.amount),
        method: i.paid_via || 'Efectivo',
      });
    });
    
    [...voucherSales, ...activeVoucherSales].slice(0, 15).forEach((v: any) => {
      movements.push({
        date: v.sold_at,
        type: 'voucher',
        description: `Voucher ${v.voucher_code || v.code}`,
        client: '-',
        amount: Number(v.price || 0),
        method: 'Efectivo',
      });
    });
    
    return movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
  }, [invoices, voucherSales, activeVoucherSales]);

  const exportCSV = () => {
    const headers = ["Fecha", "Tipo", "Descripción", "Cliente", "Monto", "Método"];
    const rows = recentMovements.map(m => [
      format(new Date(m.date), "dd/MM/yyyy HH:mm"),
      m.type === 'isp' ? 'Mensualidad' : 'Voucher',
      m.description,
      m.client,
      m.amount.toFixed(2),
      m.method,
    ]);

    const summary = [
      `Reporte Contable - ${format(startDate, 'dd/MM/yyyy')} a ${format(endDate, 'dd/MM/yyyy')}`,
      "",
      `Total Ingresos: $${balance.totalIncome.toLocaleString()}`,
      `Ingresos ISP: $${balance.ispIncome.toLocaleString()}`,
      `Ingresos Vouchers: $${balance.voucherIncome.toLocaleString()}`,
      `Por Cobrar: $${balance.pendingAmount.toLocaleString()}`,
      `Vencido: $${balance.overdueAmount.toLocaleString()}`,
      "",
      ...(resellerReport.length > 0 ? [
        "--- Reporte por Revendedor ---",
        "Nombre,Ventas,Total,Comisión %,Comisión $,Neto",
        ...resellerReport.map(r => `${r.name},${r.salesCount},$${r.totalSales.toFixed(2)},${r.commissionRate}%,$${r.commission.toFixed(2)},$${r.netIncome.toFixed(2)}`),
        "",
      ] : []),
      "--- Movimientos ---",
      headers.join(","),
      ...rows.map(r => r.join(","))
    ];

    const blob = new Blob(["\ufeff" + summary.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contabilidad_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado correctamente");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(18);
    doc.text("Reporte de Contabilidad", pw / 2, 20, { align: "center" });
    doc.setFontSize(10);
    doc.text(`${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`, pw / 2, 28, { align: "center" });
    
    let y = 42;
    doc.setFontSize(14);
    doc.text("Balance General", 20, y); y += 10;
    doc.setFontSize(10);
    doc.text(`Total Ingresos: $${balance.totalIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`  - ISP (Mensualidades): $${balance.ispIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`  - Vouchers: $${balance.voucherIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Pagos en línea: $${balance.onlinePayments.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Pagos en efectivo: $${Math.max(0, balance.cashPayments).toLocaleString()}`, 20, y); y += 7;
    doc.text(`Por cobrar: $${balance.pendingAmount.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Vencido: $${balance.overdueAmount.toLocaleString()}`, 20, y); y += 14;

    if (resellerReport.length > 0) {
      doc.setFontSize(14);
      doc.text("Reporte por Revendedor", 20, y); y += 10;
      doc.setFontSize(9);
      doc.text("Nombre", 20, y);
      doc.text("Ventas", 70, y);
      doc.text("Total", 90, y);
      doc.text("Com.%", 120, y);
      doc.text("Comisión", 145, y);
      doc.text("Neto", 175, y);
      y += 3; doc.line(20, y, 190, y); y += 5;

      resellerReport.forEach(r => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(r.name.substring(0, 25), 20, y);
        doc.text(String(r.salesCount), 70, y);
        doc.text(`$${r.totalSales.toFixed(0)}`, 90, y);
        doc.text(`${r.commissionRate}%`, 120, y);
        doc.text(`$${r.commission.toFixed(0)}`, 145, y);
        doc.text(`$${r.netIncome.toFixed(0)}`, 175, y);
        y += 7;
      });
      y += 7;
    }

    doc.setFontSize(14);
    if (y > 240) { doc.addPage(); y = 20; }
    doc.text("Últimos Movimientos", 20, y); y += 10;
    doc.setFontSize(8);
    doc.text("Fecha", 20, y); doc.text("Tipo", 50, y); doc.text("Descripción", 75, y); doc.text("Monto", 150, y); doc.text("Método", 175, y);
    y += 3; doc.line(20, y, 190, y); y += 5;
    
    recentMovements.slice(0, 30).forEach(m => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(format(new Date(m.date), "dd/MM HH:mm"), 20, y);
      doc.text(m.type === 'isp' ? 'ISP' : 'Voucher', 50, y);
      doc.text(m.description.substring(0, 35), 75, y);
      doc.text(`$${m.amount.toFixed(0)}`, 150, y);
      doc.text(m.method, 175, y);
      y += 6;
    });

    doc.setFontSize(7);
    doc.text(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pw / 2, 285, { align: "center" });
    doc.save(`contabilidad_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF exportado");
  };

  const isLoading = loadingInvoices || loadingVouchers;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-6 lg:p-8 md:ml-64 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent flex items-center gap-2">
                <PiggyBank className="w-7 h-7 text-primary" />
                Contabilidad
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Balance de caja, ingresos y reportes por revendedor
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(startDate, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">a</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(endDate, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={(d) => d && setEndDate(d)} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>Este mes</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(subMonths(startOfMonth(new Date()), 2)); setEndDate(endOfMonth(new Date())); }}>3 meses</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>Año</Button>
              </div>
              <Button variant="outline" size="sm" onClick={exportCSV}><FileSpreadsheet className="h-4 w-4 mr-1" />CSV</Button>
              <Button variant="outline" size="sm" onClick={exportPDF}><FileDown className="h-4 w-4 mr-1" />PDF</Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Total Ingresos</p>
                  <DollarSign className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xl font-bold mt-1">${balance.totalIncome.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{balance.paidCount + balance.voucherCount} operaciones</p>
              </CardContent>
            </Card>
            <Card className="border-l-4" style={{ borderLeftColor: 'hsl(var(--chart-1))' }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">ISP</p>
                  <Receipt className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xl font-bold mt-1">${balance.ispIncome.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{balance.paidCount} facturas</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-success">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Vouchers</p>
                  <ShoppingCart className="h-4 w-4 text-success" />
                </div>
                <p className="text-xl font-bold mt-1">${balance.voucherIncome.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{balance.voucherCount} vendidos</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-warning">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Por Cobrar</p>
                  <TrendingUp className="h-4 w-4 text-warning" />
                </div>
                <p className="text-xl font-bold mt-1">${balance.pendingAmount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{balance.pendingCount} pendientes</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-destructive">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Vencido</p>
                  <TrendingDown className="h-4 w-4 text-destructive" />
                </div>
                <p className="text-xl font-bold mt-1">${balance.overdueAmount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{balance.overdueCount} facturas</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 max-w-md">
              <TabsTrigger value="balance">Balance</TabsTrigger>
              <TabsTrigger value="resellers">Revendedores</TabsTrigger>
              <TabsTrigger value="movements">Movimientos</TabsTrigger>
            </TabsList>

            {/* Balance Tab */}
            <TabsContent value="balance" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Monthly Revenue Chart */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Ingresos Mensuales</CardTitle>
                    <CardDescription>ISP vs Vouchers</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {monthlyData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={monthlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <Tooltip
                            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                            formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                          />
                          <Legend />
                          <Bar dataKey="isp" name="ISP" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="vouchers" name="Vouchers" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sin datos</div>
                    )}
                  </CardContent>
                </Card>

                {/* Distribution Charts */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Distribución de Ingresos</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {incomeDistribution.length > 0 ? (
                        <ResponsiveContainer width="100%" height={140}>
                          <PieChart>
                            <Pie data={incomeDistribution} cx="50%" cy="50%" outerRadius={55} innerRadius={30} dataKey="value" paddingAngle={3}>
                              {incomeDistribution.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                            <Legend wrapperStyle={{ fontSize: '11px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Método de Pago</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {paymentMethodData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={140}>
                          <PieChart>
                            <Pie data={paymentMethodData} cx="50%" cy="50%" outerRadius={55} innerRadius={30} dataKey="value" paddingAngle={3}>
                              {paymentMethodData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                            <Legend wrapperStyle={{ fontSize: '11px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Resellers Tab */}
            <TabsContent value="resellers" className="space-y-4 mt-4">
              {resellerReport.length > 0 ? (
                <>
                  {/* Reseller summary cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {resellerReport.map((r) => (
                      <Card key={r.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Users className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{r.name}</p>
                              <p className="text-xs text-muted-foreground">{r.email}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="p-2 bg-muted/50 rounded">
                              <p className="text-xs text-muted-foreground">Ventas</p>
                              <p className="font-bold">{r.salesCount}</p>
                            </div>
                            <div className="p-2 bg-muted/50 rounded">
                              <p className="text-xs text-muted-foreground">Total</p>
                              <p className="font-bold">${r.totalSales.toLocaleString()}</p>
                            </div>
                            <div className="p-2 bg-warning/10 rounded">
                              <p className="text-xs text-muted-foreground">Comisión ({r.commissionRate}%)</p>
                              <p className="font-bold text-warning">${r.commission.toFixed(0)}</p>
                            </div>
                            <div className="p-2 bg-success/10 rounded">
                              <p className="text-xs text-muted-foreground">Neto</p>
                              <p className="font-bold text-success">${r.netIncome.toFixed(0)}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Reseller table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Detalle por Revendedor</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Revendedor</TableHead>
                            <TableHead className="text-right">Ventas</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Comisión %</TableHead>
                            <TableHead className="text-right">Comisión $</TableHead>
                            <TableHead className="text-right">Ingreso Neto</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {resellerReport.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell className="text-right">{r.salesCount}</TableCell>
                              <TableCell className="text-right">${r.totalSales.toLocaleString()}</TableCell>
                              <TableCell className="text-right">{r.commissionRate}%</TableCell>
                              <TableCell className="text-right text-warning">${r.commission.toFixed(0)}</TableCell>
                              <TableCell className="text-right font-bold text-success">${r.netIncome.toFixed(0)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/30 font-bold">
                            <TableCell>TOTAL</TableCell>
                            <TableCell className="text-right">{resellerReport.reduce((s, r) => s + r.salesCount, 0)}</TableCell>
                            <TableCell className="text-right">${resellerReport.reduce((s, r) => s + r.totalSales, 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-right text-warning">${resellerReport.reduce((s, r) => s + r.commission, 0).toFixed(0)}</TableCell>
                            <TableCell className="text-right text-success">${resellerReport.reduce((s, r) => s + r.netIncome, 0).toFixed(0)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mb-3 opacity-50" />
                    <p className="font-medium">No hay revendedores asignados</p>
                    <p className="text-sm">Asigna revendedores desde la sección de Vouchers</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Movements Tab */}
            <TabsContent value="movements" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Movimientos Recientes</CardTitle>
                  <CardDescription>Últimos pagos e ingresos registrados</CardDescription>
                </CardHeader>
                <CardContent>
                  {recentMovements.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Descripción</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Método</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentMovements.map((m, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {format(new Date(m.date), "dd/MM/yy HH:mm")}
                            </TableCell>
                            <TableCell>
                              <Badge variant={m.type === 'isp' ? 'default' : 'secondary'} className="text-xs">
                                {m.type === 'isp' ? 'ISP' : 'Voucher'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{m.description}</TableCell>
                            <TableCell className="text-sm">{m.client}</TableCell>
                            <TableCell className="text-right font-medium text-success">
                              +${m.amount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs">{m.method}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Wallet className="h-12 w-12 mb-3 opacity-50" />
                      <p>No hay movimientos en este periodo</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
