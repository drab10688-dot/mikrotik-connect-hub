import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings2, Save, Loader2 } from "lucide-react";

interface BillingConfigManagerProps {
  mikrotikId: string | null;
}

interface BillingConfig {
  id: string;
  mikrotik_id: string;
  billing_day: number;
  grace_period_days: number;
  reminder_days_before: number;
}

export function BillingConfigManager({ mikrotikId }: BillingConfigManagerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    billing_day: 1,
    grace_period_days: 5,
    reminder_days_before: 3
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ['billing-config', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const { data, error } = await supabase
        .from('billing_config')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setForm({
          billing_day: data.billing_day,
          grace_period_days: data.grace_period_days,
          reminder_days_before: data.reminder_days_before
        });
      }
      return data as BillingConfig | null;
    },
    enabled: !!mikrotikId
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId) throw new Error('No hay dispositivo seleccionado');
      
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('No hay sesión activa');

      if (config) {
        // Update existing
        const { error } = await supabase
          .from('billing_config')
          .update({
            billing_day: form.billing_day,
            grace_period_days: form.grace_period_days,
            reminder_days_before: form.reminder_days_before
          })
          .eq('id', config.id);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('billing_config')
          .insert({
            mikrotik_id: mikrotikId,
            billing_day: form.billing_day,
            grace_period_days: form.grace_period_days,
            reminder_days_before: form.reminder_days_before,
            created_by: userData.user.id
          });
        if (error) throw error;
      }
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
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para configurar la facturación
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Settings2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Configuración Universal de Facturación</CardTitle>
            <CardDescription>
              Estos valores se aplicarán a todos los nuevos clientes automáticamente
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="billing_day">Día de Facturación</Label>
            <Input
              id="billing_day"
              type="number"
              min={1}
              max={28}
              value={form.billing_day}
              onChange={(e) => setForm(prev => ({ ...prev, billing_day: parseInt(e.target.value) || 1 }))}
            />
            <p className="text-xs text-muted-foreground">
              Día del mes para generar facturas (1-28)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grace_period">Días de Gracia</Label>
            <Input
              id="grace_period"
              type="number"
              min={0}
              max={30}
              value={form.grace_period_days}
              onChange={(e) => setForm(prev => ({ ...prev, grace_period_days: parseInt(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground">
              Días adicionales después del vencimiento
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reminder_days">Días de Recordatorio</Label>
            <Input
              id="reminder_days"
              type="number"
              min={0}
              max={15}
              value={form.reminder_days_before}
              onChange={(e) => setForm(prev => ({ ...prev, reminder_days_before: parseInt(e.target.value) || 3 }))}
            />
            <p className="text-xs text-muted-foreground">
              Días antes del vencimiento para enviar recordatorio
            </p>
          </div>
        </div>

        <Button 
          onClick={() => saveMutation.mutate()} 
          disabled={saveMutation.isPending}
          className="w-full md:w-auto"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Guardar Configuración
        </Button>
      </CardContent>
    </Card>
  );
}
