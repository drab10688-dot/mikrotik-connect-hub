import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, DollarSign } from "lucide-react";

interface VoucherPreset {
  name: string;
  validity: string;
  price: number;
  description: string;
}

const PRESETS: VoucherPreset[] = [
  { name: "1 Hora", validity: "1h", price: 1.00, description: "Acceso rápido" },
  { name: "3 Horas", validity: "3h", price: 2.50, description: "Media jornada" },
  { name: "Día Completo", validity: "24h", price: 5.00, description: "24 horas" },
  { name: "3 Días", validity: "3d", price: 12.00, description: "Fin de semana" },
  { name: "Semanal", validity: "7d", price: 20.00, description: "Una semana" },
  { name: "Mensual", validity: "30d", price: 50.00, description: "Un mes" },
];

interface VoucherPresetsProps {
  onSelectPreset: (validity: string, price: number) => void;
}

export function VoucherPresets({ onSelectPreset }: VoucherPresetsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Presets de Vouchers</CardTitle>
        <CardDescription>Selecciona una configuración predefinida</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="outline"
              className="h-auto flex-col items-start p-4 hover:bg-primary/10 hover:border-primary"
              onClick={() => onSelectPreset(preset.validity, preset.price)}
            >
              <div className="font-semibold text-sm mb-2">{preset.name}</div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Clock className="h-3 w-3" />
                <span>{preset.description}</span>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-primary">
                <DollarSign className="h-3 w-3" />
                <span>${Number(preset.price).toFixed(2)}</span>
              </div>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}