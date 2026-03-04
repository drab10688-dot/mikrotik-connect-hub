import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DollarSign, Users, FileDown, FileSpreadsheet, CalendarIcon, ShoppingCart, PiggyBank } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, eachMonthOfInterval, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { toast } from "sonner";
import jsPDF from "jspdf";

export function HmonAccounting() {
  const mikrotikId = getSelectedDeviceId();
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [tab, setTab] = useState("balance");
  const dk = `${format(startDate, "yyyy-MM-dd")}_${format(endDate, "yyyy-MM-dd")}`;

  const { data: salesHistory = [] } = useQuery({
    queryKey: ["hmon-acc-sales", mikrotikId, dk],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase.from("voucher_sales_history").select("*").eq("mikrotik_id", mikrotikId).gte("sold_at", format(startDate, "yyyy-MM-dd")).lte("sold_at", format(endDate, "yyyy-MM-dd")).order("sold_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  const { data: activeSold = [] } = useQuery({
    queryKey: ["hmon-acc-active", mikrotikId, dk],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase.from("vouchers").select("*").eq("mikrotik_id", mikrotikId).eq("status", "sold").gte("sold_at", format(startDate, "yyyy-MM-dd")).lte("sold_at", format(endDate, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  const { data: resellers = [] } = useQuery({
    queryKey: ["hmon-acc-resellers", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data } = await supabase.from("reseller_assignments").select("*").eq("mikrotik_id", mikrotikId);
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  const { data: resellerProfiles = [] } = useQuery({
    queryKey: ["hmon-acc-reseller-profiles", resellers],
    queryFn: async () => {
      if (!resellers.length) return [];
      const ids = resellers.map((r: any) => r.reseller_id);
      const { data } = await supabase.from("profiles").select("*").in("user_id", ids);
      return data || [];
    },
    enabled: resellers.length > 0,
  });

  const allSales = useMemo(() => [...salesHistory, ...activeSold], [salesHistory, activeSold]);
  const balance = useMemo(() => ({ totalIncome: allSales.reduce((s: number, v: any) => s + Number(v.price || 0), 0), count: allSales.length }), [allSales]);

  const monthlyData = useMemo(() => {
    return eachMonthOfInterval({ start: startDate, end: endDate }).map(date => {
      const mv = allSales.filter((v: any) => isSameMonth(new Date(v.sold_at), date));
      return { month: format(date, "MMM", { locale: es }), vouchers: mv.reduce((s: number, v: any) => s + Number(v.price || 0), 0) };
    });
  }, [allSales, startDate, endDate]);

  const resellerReport = useMemo(() => {
    return resellers.map((r: any) => {
      const sales = allSales.filter((v: any) => v.sold_by === r.reseller_id);
      const total = sales.reduce((s: number, v: any) => s + Number(v.price || 0), 0);
      const commission = total * (Number(r.commission_percentage) / 100);
      const profile = resellerProfiles.find((p: any) => p.user_id === r.reseller_id);
      return { id: r.id, name: profile?.full_name || profile?.email || "Sin nombre", email: profile?.email || "", salesCount: sales.length, totalSales: total, commissionRate: Number(r.commission_percentage), commission, netIncome: total - commission };
    });
  }, [resellers, allSales, resellerProfiles]);

  const movements = useMemo(() => {
    return allSales.map((v: any) => ({ date: v.sold_at, description: `Voucher ${v.voucher_code || v.code}`, amount: Number(v.price || 0), profile: v.profile || "-" })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  }, [allSales]);

  const exportCSV = () => {
    const lines = [`Contabilidad HMON - ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`, "", `Total: $${balance.totalIncome.toLocaleString()}`, `Ventas: ${balance.count}`, "",
      ...(resellerReport.length > 0 ? ["--- Revendedores ---", "Nombre,Ventas,Total,Comisión%,Comisión$,Neto", ...resellerReport.map(r => `${r.name},${r.salesCount},$${r.totalSales.toFixed(2)},${r.commissionRate}%,$${r.commission.toFixed(2)},$${r.netIncome.toFixed(2)}`), ""] : []),
      "--- Ventas ---", "Fecha,Voucher,Perfil,Monto", ...movements.map(m => `${format(new Date(m.date), "dd/MM/yyyy HH:mm")},${m.description},${m.profile},${m.amount.toFixed(2)}`)];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `hmon_contabilidad_${format(startDate, "yyyy-MM-dd")}.csv`; a.click();
    toast.success("CSV exportado");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(16); doc.text("Contabilidad HMON", pw / 2, 20, { align: "center" });
    doc.setFontSize(10); doc.text(`${format(startDate, "dd/MM/yyyy")} - ${format(endDate, "dd/MM/yyyy")}`, pw / 2, 28, { align: "center" });
    let y = 42;
    doc.setFontSize(12); doc.text("Resumen", 20, y); y += 8;
    doc.setFontSize(10); doc.text(`Total Ingresos: $${balance.totalIncome.toLocaleString()}`, 20, y); y += 7; doc.text(`Vouchers Vendidos: ${balance.count}`, 20, y); y += 12;
    if (resellerReport.length > 0) {
      doc.setFontSize(12); doc.text("Revendedores", 20, y); y += 8; doc.setFontSize(9);
      resellerReport.forEach(r => { if (y > 270) { doc.addPage(); y = 20; } doc.text(`${r.name}: ${r.salesCount} ventas, $${r.totalSales.toFixed(0)} | Com: $${r.commission.toFixed(0)} (${r.commissionRate}%) | Neto: $${r.netIncome.toFixed(0)}`, 20, y); y += 6; });
      y += 6;
    }
    doc.setFontSize(7); doc.text(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")} | HMON by Omnisync`, pw / 2, 285, { align: "center" });
    doc.save(`hmon_contabilidad_${format(startDate, "yyyy-MM-dd")}.pdf`);
    toast.success("PDF exportado");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2"><PiggyBank className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Contabilidad</h2></div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs"><CalendarIcon className="mr-1 h-3 w-3" />{format(startDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
          <span className="text-muted-foreground text-xs">a</span>
          <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs"><CalendarIcon className="mr-1 h-3 w-3" />{format(endDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={(d) => d && setEndDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>Mes</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(subMonths(startOfMonth(new Date()), 2)); setEndDate(endOfMonth(new Date())); }}>3M</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>Año</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportCSV}><FileSpreadsheet className="h-3 w-3 mr-1" />CSV</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportPDF}><FileDown className="h-3 w-3 mr-1" />PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-primary"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Total Ingresos</p><DollarSign className="h-3.5 w-3.5 text-primary" /></div><p className="text-lg font-bold mt-1">${balance.totalIncome.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">{balance.count} ventas</p></CardContent></Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-2))]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Vendidos</p><ShoppingCart className="h-3.5 w-3.5 text-[hsl(var(--chart-2))]" /></div><p className="text-lg font-bold mt-1">{balance.count}</p></CardContent></Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-4))]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Revendedores</p><Users className="h-3.5 w-3.5 text-[hsl(var(--chart-4))]" /></div><p className="text-lg font-bold mt-1">{resellers.length}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8"><TabsTrigger value="balance" className="text-xs">Balance</TabsTrigger><TabsTrigger value="resellers" className="text-xs">Revendedores</TabsTrigger><TabsTrigger value="movements" className="text-xs">Ventas</TabsTrigger></TabsList>

        <TabsContent value="balance" className="mt-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ingresos por Vouchers</CardTitle></CardHeader><CardContent>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} formatter={(v: number) => [`$${v.toLocaleString()}`, ""]} />
                  <Bar dataKey="vouchers" name="Vouchers" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-[250px] text-muted-foreground text-xs">Sin datos</div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="resellers" className="mt-3 space-y-3">
          {resellerReport.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {resellerReport.map(r => (
                <Card key={r.id}><CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Users className="h-4 w-4 text-primary" /></div><div><p className="font-medium text-xs">{r.name}</p><p className="text-[10px] text-muted-foreground">{r.email}</p></div></div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <div className="p-1.5 bg-muted/50 rounded"><p className="text-[10px] text-muted-foreground">Ventas</p><p className="font-bold">{r.salesCount}</p></div>
                    <div className="p-1.5 bg-muted/50 rounded"><p className="text-[10px] text-muted-foreground">Total</p><p className="font-bold">${r.totalSales.toLocaleString()}</p></div>
                    <div className="p-1.5 bg-[hsl(var(--chart-4))]/10 rounded"><p className="text-[10px] text-muted-foreground">Comisión ({r.commissionRate}%)</p><p className="font-bold text-[hsl(var(--chart-4))]">${r.commission.toFixed(0)}</p></div>
                    <div className="p-1.5 bg-[hsl(var(--chart-2))]/10 rounded"><p className="text-[10px] text-muted-foreground">Neto</p><p className="font-bold text-[hsl(var(--chart-2))]">${r.netIncome.toFixed(0)}</p></div>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          ) : <Card><CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground"><Users className="h-10 w-10 mb-2 opacity-50" /><p className="text-sm">No hay revendedores asignados</p></CardContent></Card>}
        </TabsContent>

        <TabsContent value="movements" className="mt-3">
          <Card><CardContent className="p-0"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="text-[10px]">Fecha</TableHead><TableHead className="text-[10px]">Voucher</TableHead><TableHead className="text-[10px]">Perfil</TableHead><TableHead className="text-[10px] text-right">Monto</TableHead></TableRow></TableHeader>
              <TableBody>
                {movements.length > 0 ? movements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[10px] whitespace-nowrap">{format(new Date(m.date), "dd/MM/yy HH:mm")}</TableCell>
                    <TableCell className="text-xs">{m.description}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{m.profile}</Badge></TableCell>
                    <TableCell className="text-right text-xs font-medium text-[hsl(var(--chart-2))]">+${m.amount.toLocaleString()}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs">Sin ventas en este periodo</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
