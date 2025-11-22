import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, DollarSign, Plus, Trash2 } from "lucide-react";
import { useVoucherPresets } from "@/hooks/useVoucherPresets";

interface VoucherPresetsManagerProps {
  mikrotikId: string;
  onSelectPreset: (presetId: string, validity: string, price: number) => void;
}

export function VoucherPresetsManager({ mikrotikId, onSelectPreset }: VoucherPresetsManagerProps) {
  const { presets, isLoading, createPreset, isCreating, deletePreset } = useVoucherPresets(mikrotikId);
  const [open, setOpen] = useState(false);
  const [newPreset, setNewPreset] = useState({
    name: "",
    validity: "24h",
    price: 0,
    description: "",
  });

  const handleCreate = () => {
    if (!newPreset.name || !newPreset.validity) {
      return;
    }

    createPreset({
      name: newPreset.name,
      validity: newPreset.validity,
      price: newPreset.price,
      description: newPreset.description,
      mikrotikId,
    });

    setNewPreset({ name: "", validity: "24h", price: 0, description: "" });
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Presets de Vouchers</CardTitle>
            <CardDescription>Selecciona o crea configuraciones predefinidas</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Preset
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Preset de Voucher</DialogTitle>
                <DialogDescription>
                  Define una configuración predefinida para generar vouchers rápidamente
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    value={newPreset.name}
                    onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
                    placeholder="ej: Plan Diario"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Límite de velocidad (Rate Limit)</Label>
                  <Input
                    id="description"
                    value={newPreset.description}
                    onChange={(e) => setNewPreset({ ...newPreset, description: e.target.value })}
                    placeholder="ej: 10M/10M"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="validity">Validez</Label>
                  <Select value={newPreset.validity} onValueChange={(value) => setNewPreset({ ...newPreset, validity: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">1 hora</SelectItem>
                      <SelectItem value="3h">3 horas</SelectItem>
                      <SelectItem value="6h">6 horas</SelectItem>
                      <SelectItem value="12h">12 horas</SelectItem>
                      <SelectItem value="24h">24 horas</SelectItem>
                      <SelectItem value="3d">3 días</SelectItem>
                      <SelectItem value="7d">7 días</SelectItem>
                      <SelectItem value="30d">30 días</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Precio</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newPreset.price}
                    onChange={(e) => setNewPreset({ ...newPreset, price: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
                <Button onClick={handleCreate} disabled={isCreating} className="w-full">
                  {isCreating ? 'Creando...' : 'Crear Preset'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando presets...</div>
        ) : presets && presets.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {presets.map((preset) => (
              <div key={preset.id} className="relative group">
                <Button
                  variant="outline"
                  className="h-auto w-full flex-col items-start p-4 hover:bg-primary/10 hover:border-primary"
                  onClick={() => onSelectPreset(preset.id, preset.validity, preset.price)}
                >
                  <div className="font-semibold text-sm mb-2">{preset.name}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    <span>{preset.description || preset.validity}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-primary">
                    <DollarSign className="h-3 w-3" />
                    <span>${preset.price.toFixed(2)}</span>
                  </div>
                </Button>
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`¿Eliminar preset "${preset.name}"?`)) {
                      deletePreset(preset.id);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No hay presets configurados. Crea uno para empezar.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
