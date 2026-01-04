import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Settings2, Trash2, Plus, Tv, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServiceOptions, ServiceOption } from "@/hooks/useServiceOptions";

interface ServicePricesManagerProps {
  mikrotikId: string | null;
  onPricesChange?: () => void;
}

export function ServicePricesManager({ mikrotikId, onPricesChange }: ServicePricesManagerProps) {
  const [open, setOpen] = useState(false);
  const { services, loading, updateService, addService, deleteService } = useServiceOptions(
    open ? mikrotikId : null
  );
  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({});
  const [editingDescriptions, setEditingDescriptions] = useState<Record<string, string>>({});
  const [newService, setNewService] = useState({ name: "", description: "", price: "" });
  const [saving, setSaving] = useState<string | null>(null);

  const handlePriceChange = (id: string, price: string) => {
    setEditingPrices(prev => ({ ...prev, [id]: price }));
  };

  const handlePriceSave = async (service: ServiceOption) => {
    const newPrice = editingPrices[service.id];
    if (newPrice === undefined) return;
    
    const numericPrice = parseFloat(newPrice.replace(/[^0-9.,]/g, "").replace(",", ".")) || 0;
    
    setSaving(service.id);
    const success = await updateService(service.id, { price: numericPrice });
    setSaving(null);
    
    if (success) {
      toast.success("Precio actualizado");
      onPricesChange?.();
      setEditingPrices(prev => {
        const next = { ...prev };
        delete next[service.id];
        return next;
      });
    }
  };

  const handleDescriptionChange = (id: string, description: string) => {
    setEditingDescriptions(prev => ({ ...prev, [id]: description }));
  };

  const handleDescriptionSave = async (service: ServiceOption) => {
    const newDescription = editingDescriptions[service.id];
    if (newDescription === undefined) return;
    
    await updateService(service.id, { description: newDescription });
    setEditingDescriptions(prev => {
      const next = { ...prev };
      delete next[service.id];
      return next;
    });
  };

  const handleAddService = async () => {
    if (!newService.name.trim()) {
      toast.error("El nombre del servicio es requerido");
      return;
    }

    const price = parseFloat(newService.price.replace(/[^0-9.,]/g, "").replace(",", ".")) || 0;
    
    const success = await addService(
      newService.name.trim(),
      newService.description.trim(),
      price
    );

    if (success) {
      setNewService({ name: "", description: "", price: "" });
      onPricesChange?.();
    }
  };

  const handleDeleteService = async (id: string) => {
    const success = await deleteService(id);
    if (success) {
      onPricesChange?.();
    }
  };

  const getDisplayPrice = (service: ServiceOption) => {
    return editingPrices[service.id] ?? service.price.toString();
  };

  const getDisplayDescription = (service: ServiceOption) => {
    return editingDescriptions[service.id] ?? (service.description || "");
  };

  if (!mikrotikId) {
    return (
      <Button variant="outline" size="sm" className="gap-2" disabled>
        <Tv className="h-4 w-4" />
        Gestionar Servicios
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Tv className="h-4 w-4" />
          Gestionar Servicios
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Configurar Servicios Adicionales
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure los precios de los servicios adicionales. Estos precios se sumarán al costo del plan de internet.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-[150px]">Precio</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell>
                      <Input
                        value={getDisplayDescription(service)}
                        onChange={(e) => handleDescriptionChange(service.id, e.target.value)}
                        onBlur={() => handleDescriptionSave(service)}
                        placeholder="Descripción"
                        className="h-8 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="relative">
                        <Input
                          value={getDisplayPrice(service)}
                          onChange={(e) => handlePriceChange(service.id, e.target.value)}
                          onBlur={() => handlePriceSave(service)}
                          placeholder="$0"
                          className="h-8 text-sm pr-8"
                        />
                        {saving === service.id && (
                          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {!service.is_default && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteService(service.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Agregar nuevo servicio */}
          <div className="border-t pt-4 space-y-3">
            <Label className="text-sm font-medium">Agregar nuevo servicio</Label>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                value={newService.name}
                onChange={(e) => setNewService(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nombre del servicio"
                className="md:col-span-1"
              />
              <Input
                value={newService.description}
                onChange={(e) => setNewService(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descripción (opcional)"
                className="md:col-span-1"
              />
              <Input
                value={newService.price}
                onChange={(e) => setNewService(prev => ({ ...prev, price: e.target.value }))}
                placeholder="Precio"
                className="md:col-span-1"
              />
              <Button onClick={handleAddService} className="gap-2">
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ejemplo: "CCTV", "Servicio de monitoreo de cámaras", "$25.000"
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export hook types for convenience
export type { ServiceOption } from "@/hooks/useServiceOptions";
