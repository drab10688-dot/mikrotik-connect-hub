import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billingApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Settings2, Save, Loader2, CalendarDays, Clock, Send, MessageCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface BillingConfigManagerProps {
  mikrotikId: string | null;
}

interface BillingConfig {
  id: string;
  mikrotik_id: string;
  billing_day: number;
  grace_period_days: number;
  reminder_days_before: number;
  billing_type: 'advance' | 'due';
  invoice_maturity_days: number;
  auto_send_telegram: boolean;
  auto_send_whatsapp: boolean;
}

export function BillingConfigManager({ mikrotikId }: BillingConfigManagerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    billing_day: 1, grace_period_days: 5, reminder_days_before: 3,
    billing_type: 'advance' as 'advance' | 'due', invoice_maturity_days: 15,
    auto_send_telegram: false, auto_send_whatsapp: false
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ['billing-config', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      return billingApi.getConfig(mikrotikId);
    },
    enabled: !!mikrotikId
  });

  useEffect(() => {
    if (config) {
      setForm({
        billing_day: config.billing_day, grace_period_days: config.grace_period_days,
        reminder_days_before: config.reminder_days_before, billing_type: config.billing_type || 'advance',
        invoice_maturity_days: config.invoice_maturity_days || 15,
        auto_send_telegram: config.auto_send_telegram || false, auto_send_whatsapp: config.auto_send_whatsapp || false
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId) throw new Error('No hay dispositivo seleccionado');
      await billingApi.saveConfig({ mikrotik_id: mikrotikId, ...form });
    },
    onSuccess: () => {
      toast.success('Configuración de facturación guardada');
      queryClient.invalidateQueries({ queryKey: ['billing-config', mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al guardar configuración');
    }
  });

  if (!mikrotikId) {
    return (<Card><CardContent className="py-8 text-center text-muted-foreground">Selecciona un dispositivo MikroTik para configurar la facturación</CardContent></Card>);
  }

  if (isLoading) {
    return (<Card><CardContent className="py-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><Settings2 className="h-5 w-5 text-primary" /></div>
          <div><CardTitle>Configuración de Facturación</CardTitle><CardDescription>Configura cómo se generan y envían las facturas automáticamente</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /><Label className="text-base font-medium">Tipo de Facturación</Label></div>
          <RadioGroup value={form.billing_type} onValueChange={(value: 'advance' | 'due') => setForm(prev => ({ ...prev, billing_type: value }))} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`flex items-start space-x-3 border rounded-lg p-4 cursor-pointer transition-colors ${form.billing_type === 'advance' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
              <RadioGroupItem value="advance" id="advance" className="mt-1" />
              <div className="space-y-1"><Label htmlFor="advance" className="font-medium cursor-pointer">Factura Anticipada</Label><p className="text-sm text-muted-foreground">Se genera al registrar un nuevo cliente</p></div>
            </div>
            <div className={`flex items-start space-x-3 border rounded-lg p-4 cursor-pointer transition-colors ${form.billing_type === 'due' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
              <RadioGroupItem value="due" id="due" className="mt-1" />
              <div className="space-y-1"><Label htmlFor="due" className="font-medium cursor-pointer">Factura al Vencimiento</Label><p className="text-sm text-muted-foreground">Se genera el día de facturación cada mes</p></div>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><Label className="text-base font-medium">Parámetros</Label></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2"><Label>Día de Facturación</Label><Input type="number" min={1} max={28} value={form.billing_day} onChange={(e) => setForm(prev => ({ ...prev, billing_day: parseInt(e.target.value) || 1 }))} /><p className="text-xs text-muted-foreground">Día del mes (1-28)</p></div>
            <div className="space-y-2"><Label>Madurez de Factura</Label><Input type="number" min={1} max={60} value={form.invoice_maturity_days} onChange={(e) => setForm(prev => ({ ...prev, invoice_maturity_days: parseInt(e.target.value) || 15 }))} /><p className="text-xs text-muted-foreground">Días hasta vencimiento</p></div>
            <div className="space-y-2"><Label>Días de Gracia</Label><Input type="number" min={0} max={30} value={form.grace_period_days} onChange={(e) => setForm(prev => ({ ...prev, grace_period_days: parseInt(e.target.value) || 0 }))} /><p className="text-xs text-muted-foreground">Después del vencimiento</p></div>
            <div className="space-y-2"><Label>Días de Recordatorio</Label><Input type="number" min={0} max={15} value={form.reminder_days_before} onChange={(e) => setForm(prev => ({ ...prev, reminder_days_before: parseInt(e.target.value) || 3 }))} /><p className="text-xs text-muted-foreground">Antes del vencimiento</p></div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center gap-2"><Send className="h-4 w-4 text-muted-foreground" /><Label className="text-base font-medium">Envío Automático</Label></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between border rounded-lg p-4">
              <div className="flex items-center gap-3"><div className="p-2 rounded-full bg-blue-500/10"><Send className="h-4 w-4 text-blue-500" /></div><div><Label htmlFor="auto_telegram" className="font-medium">Telegram</Label><p className="text-sm text-muted-foreground">Enviar factura por Telegram</p></div></div>
              <Switch id="auto_telegram" checked={form.auto_send_telegram} onCheckedChange={(checked) => setForm(prev => ({ ...prev, auto_send_telegram: checked }))} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-4">
              <div className="flex items-center gap-3"><div className="p-2 rounded-full bg-green-500/10"><MessageCircle className="h-4 w-4 text-green-500" /></div><div><Label htmlFor="auto_whatsapp" className="font-medium">WhatsApp</Label><p className="text-sm text-muted-foreground">Enviar factura por WhatsApp</p></div></div>
              <Switch id="auto_whatsapp" checked={form.auto_send_whatsapp} onCheckedChange={(checked) => setForm(prev => ({ ...prev, auto_send_whatsapp: checked }))} />
            </div>
          </div>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full md:w-auto">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Guardar Configuración
        </Button>
      </CardContent>
    </Card>
  );
}
