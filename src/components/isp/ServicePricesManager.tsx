import { useState, useEffect } from "react";
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
import { Settings2, Trash2, Plus, Tv } from "lucide-react";
import { toast } from "sonner";

export interface ServiceOption {
  id: string;
  name: string;
  description: string;
  price: string;
}

interface ServicePricesManagerProps {
  onPricesChange?: () => void;
}

const DEFAULT_SERVICES: ServiceOption[] = [
  { id: "solo-internet", name: "Solo Internet", description: "", price: "0" },
  { id: "tv-incluido", name: "TV Incluido en el Plan", description: "Sin costo adicional", price: "0" },
  { id: "tv-adicional", name: "+TV Adicional", description: "Agregar servicio de TV con costo adicional", price: "" },
  { id: "solo-tv", name: "Solo TV", description: "Solo servicio de televisión sin internet", price: "" },
];

export function ServicePricesManager({ onPricesChange }: ServicePricesManagerProps) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [newService, setNewService] = useState({ name: "", description: "", price: "" });

  // Cargar servicios desde localStorage
  useEffect(() => {
    const saved = localStorage.getItem("isp_service_options");
    if (saved) {
      setServices(JSON.parse(saved));
    } else {
      setServices(DEFAULT_SERVICES);
      localStorage.setItem("isp_service_options", JSON.stringify(DEFAULT_SERVICES));
    }
  }, [open]);

  const saveServices = (updatedServices: ServiceOption[]) => {
    localStorage.setItem("isp_service_options", JSON.stringify(updatedServices));
    setServices(updatedServices);
    onPricesChange?.();
  };

  const handleUpdatePrice = (id: string, price: string) => {
    const updated = services.map(s => 
      s.id === id ? { ...s, price } : s
    );
    saveServices(updated);
    toast.success("Precio actualizado");
  };

  const handleUpdateDescription = (id: string, description: string) => {
    const updated = services.map(s => 
      s.id === id ? { ...s, description } : s
    );
    saveServices(updated);
  };

  const handleAddService = () => {
    if (!newService.name.trim()) {
      toast.error("El nombre del servicio es requerido");
      return;
    }

    const id = newService.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    
    if (services.some(s => s.id === id)) {
      toast.error("Ya existe un servicio con ese nombre");
      return;
    }

    const updated = [...services, { 
      id, 
      name: newService.name.trim(), 
      description: newService.description.trim(),
      price: newService.price.trim() || "0"
    }];
    saveServices(updated);
    setNewService({ name: "", description: "", price: "" });
    toast.success("Servicio agregado");
  };

  const handleDeleteService = (id: string) => {
    // No permitir eliminar los servicios por defecto
    if (["solo-internet", "tv-incluido", "tv-adicional", "solo-tv"].includes(id)) {
      toast.error("No se pueden eliminar los servicios predeterminados");
      return;
    }

    const updated = services.filter(s => s.id !== id);
    saveServices(updated);
    toast.success("Servicio eliminado");
  };

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
                      value={service.description}
                      onChange={(e) => handleUpdateDescription(service.id, e.target.value)}
                      placeholder="Descripción"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={service.price}
                      onChange={(e) => handleUpdatePrice(service.id, e.target.value)}
                      placeholder="$0"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    {!["solo-internet", "tv-incluido", "tv-adicional", "solo-tv"].includes(service.id) && (
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

// Función auxiliar para obtener los servicios guardados
export function getServiceOptions(): ServiceOption[] {
  const saved = localStorage.getItem("isp_service_options");
  if (saved) {
    return JSON.parse(saved);
  }
  return DEFAULT_SERVICES;
}

// Función para obtener el precio de un servicio por ID
export function getServicePrice(serviceId: string): string {
  const services = getServiceOptions();
  const service = services.find(s => s.id === serviceId);
  return service?.price || "0";
}

// Función para calcular el precio total (plan + servicio adicional)
export function calculateTotalPrice(planPrice: string, serviceId: string): number {
  const cleanPrice = (price: string): number => {
    const num = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", "."));
    return isNaN(num) ? 0 : num;
  };

  const servicePriceStr = getServicePrice(serviceId);
  return cleanPrice(planPrice) + cleanPrice(servicePriceStr);
}
