import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoicesApi, vouchersApi, resellersApi, transactionsApi, apiGet } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Users, FileDown,
  FileSpreadsheet, CalendarIcon, Receipt, ShoppingCart, PiggyBank
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

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['accounting-invoices', mikrotikId, dateKey],
    queryFn: () => mikrotikId ? invoicesApi.list(mikrotikId, { start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd') }) : [],
    enabled: !!mikrotikId,
  });

  const { data: voucherSales = [], isLoading: loadingVouchers } = useQuery({
    queryKey: ['accounting-voucher-sales', mikrotikId, dateKey],
    queryFn: () => mikrotikId ? vouchersApi.salesHistory(mikrotikId) : [],
    enabled: !!mikrotikId,
  });

  const { data: resellers = [] } = useQuery({
    queryKey: ['accounting-resellers', mikrotikId],
    queryFn: () => mikrotikId ? resellersApi.assignments(mikrotikId) : [],
    enabled: !!mikrotikId,
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['accounting-transactions', mikrotikId, dateKey],
    queryFn: () => mikrotikId ? transactionsApi.list(mikrotikId, { status: 'approved', start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd') }) : [],
    enabled: !!mikrotikId,
  });

  const balance = useMemo(() => {
    const paidInvoices = invoices.filter((i: any) => i.status === 'paid');
    const ispIncome = paidInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0);
    const voucherIncome = voucherSales.reduce((s: number, v: any) => s + Number(v.price || 0), 0);
    const onlinePayments = transactions.reduce((s: number, t: any) => s + Number(t.amount), 0);
    const pendingInvoices = invoices.filter((i: any) => i.status === 'pending');
    const overdueInvoices = invoices.filter((i: any) => i.status === 'overdue');
    return {
      totalIncome: ispIncome + voucherIncome, ispIncome, voucherIncome, onlinePayments,
      cashPayments: ispIncome - onlinePayments,
      pendingAmount: pendingInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0),
      overdueAmount: overdueInvoices.reduce((s: number, i: any) => s + Number(i.amount), 0),
      paidCount: paidInvoices.length, pendingCount: pendingInvoices.length, overdueCount: overdueInvoices.length,
      voucherCount: voucherSales.length,
    };
  }, [invoices, voucherSales, transactions]);

  const monthlyData = useMemo(() => {
    const months = eachMonthOfInterval({ start: startDate, end: endDate });
    return months.map(date => {
      const mi = invoices.filter((i: any) => i.status === 'paid' && isSameMonth(new Date(i.paid_at || i.created_at), date));
      const mv = voucherSales.filter((v: any) => isSameMonth(new Date(v.sold_at), date));
      return { month: format(date, 'MMM', { locale: es }), isp: mi.reduce((s: number, i: any) => s + Number(i.amount), 0), vouchers: mv.reduce((s: number, v: any) => s + Number(v.price || 0), 0) };
    });
  }, [invoices, voucherSales, startDate, endDate]);

  const incomeDistribution = useMemo(() => [
    { name: 'ISP (Mensualidades)', value: balance.ispIncome, color: 'hsl(var(--chart-1))' },
    { name: 'Vouchers', value: balance.voucherIncome, color: 'hsl(var(--chart-2))' },
  ].filter(i => i.value > 0), [balance]);

  const resellerReport = useMemo(() => {
    return resellers.map((r: any) => {
      const sales = voucherSales.filter((v: any) => v.sold_by === r.reseller_id);
      const totalSales = sales.reduce((s: number, v: any) => s + Number(v.price || 0), 0);
      const commission = totalSales * (Number(r.commission_percentage) / 100);
      return { id: r.id, name: r.reseller_name || r.reseller_email || 'Sin nombre', email: r.reseller_email || '', salesCount: sales.length, totalSales, commissionRate: Number(r.commission_percentage), commission, netIncome: totalSales - commission };
    });
  }, [resellers, voucherSales]);

  const recentMovements = useMemo(() => {
    const movements: any[] = [];
    invoices.filter((i: any) => i.status === 'paid').slice(0, 15).forEach((i: any) => {
      movements.push({ date: i.paid_at || i.created_at, type: 'isp', description: `Pago factura ${i.invoice_number}`, client: i.client_name || '-', amount: Number(i.amount), method: i.paid_via || 'Efectivo' });
    });
    voucherSales.slice(0, 15).forEach((v: any) => {
      movements.push({ date: v.sold_at, type: 'voucher', description: `Voucher ${v.voucher_code || v.code}`, client: '-', amount: Number(v.price || 0), method: 'Efectivo' });
    });
    return movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
  }, [invoices, voucherSales]);

  const exportCSV = () => {
    const rows = recentMovements.map(m => [format(new Date(m.date), "dd/MM/yyyy HH:mm"), m.type === 'isp' ? 'Mensualidad' : 'Voucher', m.description, m.client, m.amount.toFixed(2), m.method]);
    const summary = [`Reporte Contable - ${format(startDate, 'dd/MM/yyyy')} a ${format(endDate, 'dd/MM/yyyy')}`, "", `Total Ingresos: $${balance.totalIncome.toLocaleString()}`, "", "Fecha,Tipo,Descripción,Cliente,Monto,Método", ...rows.map(r => r.join(","))];
    const blob = new Blob(["\ufeff" + summary.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url;
    link.download = `contabilidad_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.csv`; link.click(); URL.revokeObjectURL(url);
    toast.success("CSV exportado correctamente");
  };

  const exportPDF = () => {
    const doc = new jsPDF(); const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(18); doc.text("Reporte de Contabilidad", pw / 2, 20, { align: "center" });
    doc.setFontSize(10); doc.text(`${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`, pw / 2, 28, { align: "center" });
    let y = 42; doc.setFontSize(14); doc.text("Balance General", 20, y); y += 10; doc.setFontSize(10);
    doc.text(`Total Ingresos: $${balance.totalIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`ISP: $${balance.ispIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Vouchers: $${balance.voucherIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Por cobrar: $${balance.pendingAmount.toLocaleString()}`, 20, y); y += 14;
    doc.save(`contabilidad_${format(startDate, 'yyyy-MM-dd')}_${format(endDate, 'yyyy-MM-dd')}.pdf`);
    toast.success("PDF exportado");
  };

  const isLoading = loadingInvoices || loadingVouchers;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-6 lg:p-8 md:ml-64 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div><h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent flex items-center gap-2"><PiggyBank className="w-7 h-7 text-primary" />Contabilidad</h1><p className="text-sm text-muted-foreground mt-1">Balance de caja, ingresos y reportes</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><CalendarIcon className="mr-2 h-4 w-4" />{format(startDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
              <span className="text-muted-foreground text-sm">a</span>
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><CalendarIcon className="mr-2 h-4 w-4" />{format(endDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={(d) => d && setEndDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>Este mes</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(subMonths(startOfMonth(new Date()), 2)); setEndDate(endOfMonth(new Date())); }}>3 meses</Button>
                <Button variant="ghost" size="sm" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>Año</Button>
              </div>
              <Button variant="outline" size="sm" onClick={exportCSV}><FileSpreadsheet className="h-4 w-4 mr-1" />CSV</Button>
              <Button variant="outline" size="sm" onClick={exportPDF}><FileDown className="h-4 w-4 mr-1" />PDF</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="border-l-4 border-l-primary"><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Total Ingresos</p><DollarSign className="h-4 w-4 text-primary" /></div><p className="text-xl font-bold mt-1">${balance.totalIncome.toLocaleString()}</p></CardContent></Card>
            <Card className="border-l-4" style={{ borderLeftColor: 'hsl(var(--chart-1))' }}><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">ISP</p><Receipt className="h-4 w-4 text-primary" /></div><p className="text-xl font-bold mt-1">${balance.ispIncome.toLocaleString()}</p></CardContent></Card>
            <Card className="border-l-4 border-l-success"><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Vouchers</p><ShoppingCart className="h-4 w-4 text-success" /></div><p className="text-xl font-bold mt-1">${balance.voucherIncome.toLocaleString()}</p></CardContent></Card>
            <Card className="border-l-4 border-l-warning"><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Por Cobrar</p><TrendingUp className="h-4 w-4 text-warning" /></div><p className="text-xl font-bold mt-1">${balance.pendingAmount.toLocaleString()}</p></CardContent></Card>
            <Card className="border-l-4 border-l-destructive"><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Vencido</p><TrendingDown className="h-4 w-4 text-destructive" /></div><p className="text-xl font-bold mt-1">${balance.overdueAmount.toLocaleString()}</p></CardContent></Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 max-w-md"><TabsTrigger value="balance">Balance</TabsTrigger><TabsTrigger value="resellers">Revendedores</TabsTrigger><TabsTrigger value="movements">Movimientos</TabsTrigger></TabsList>
            <TabsContent value="balance" className="space-y-4 mt-4">
              <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Ingresos Mensuales</CardTitle></CardHeader><CardContent>
                {monthlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}><BarChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} /><YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} /><Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, '']} /><Legend /><Bar dataKey="isp" name="ISP" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} /><Bar dataKey="vouchers" name="Vouchers" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
                ) : <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sin datos</div>}
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="resellers" className="space-y-4 mt-4">
              {resellerReport.length > 0 ? (
                <Card><CardHeader><CardTitle className="text-base">Detalle por Revendedor</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Revendedor</TableHead><TableHead className="text-right">Ventas</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Comisión %</TableHead><TableHead className="text-right">Comisión $</TableHead><TableHead className="text-right">Neto</TableHead></TableRow></TableHeader>
                    <TableBody>{resellerReport.map((r) => (<TableRow key={r.id}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="text-right">{r.salesCount}</TableCell><TableCell className="text-right">${r.totalSales.toLocaleString()}</TableCell><TableCell className="text-right">{r.commissionRate}%</TableCell><TableCell className="text-right text-warning">${r.commission.toFixed(0)}</TableCell><TableCell className="text-right font-bold text-success">${r.netIncome.toFixed(0)}</TableCell></TableRow>))}</TableBody>
                  </Table>
                </CardContent></Card>
              ) : <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground"><Users className="h-12 w-12 mb-3 opacity-50" /><p>No hay revendedores asignados</p></CardContent></Card>}
            </TabsContent>
            <TabsContent value="movements" className="space-y-4 mt-4">
              <Card><CardHeader><CardTitle className="text-base">Movimientos Recientes</CardTitle></CardHeader><CardContent>
                {recentMovements.length > 0 ? (
                  <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Descripción</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Método</TableHead></TableRow></TableHeader>
                    <TableBody>{recentMovements.map((m, idx) => (<TableRow key={idx}><TableCell className="text-xs whitespace-nowrap">{format(new Date(m.date), "dd/MM/yy HH:mm")}</TableCell><TableCell><Badge variant={m.type === 'isp' ? 'default' : 'secondary'} className="text-xs">{m.type === 'isp' ? 'ISP' : 'Voucher'}</Badge></TableCell><TableCell className="text-sm">{m.description}</TableCell><TableCell className="text-sm">{m.client}</TableCell><TableCell className="text-right font-medium text-success">+${m.amount.toLocaleString()}</TableCell><TableCell className="text-xs">{m.method}</TableCell></TableRow>))}</TableBody>
                  </Table>
                ) : <div className="flex flex-col items-center justify-center py-12 text-muted-foreground"><Wallet className="h-12 w-12 mb-3 opacity-50" /><p>No hay movimientos en este periodo</p></div>}
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
