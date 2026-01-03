import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Settings, Plus, Trash2, Edit2, DollarSign, Check, X } from "lucide-react";
import { toast } from "sonner";

interface PlanPrice {
  name: string;
  price: string;
}

interface PlanPricesManagerProps {
  plans: { name: string; rateLimit?: string }[];
  speeds: string[];
  useSimpleQueues: boolean;
  onPricesChange?: () => void;
}

export function PlanPricesManager({ plans, speeds, useSimpleQueues, onPricesChange }: PlanPricesManagerProps) {
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  const storageKey = useSimpleQueues ? "isp_speed_prices" : "isp_plan_prices";

  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : {};
  });

  // Actualizar cuando cambia el tipo de conexión
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    setPrices(saved ? JSON.parse(saved) : {});
  }, [useSimpleQueues, storageKey]);

  const saveToStorage = (newPrices: Record<string, string>) => {
    localStorage.setItem(storageKey, JSON.stringify(newPrices));
    setPrices(newPrices);
    onPricesChange?.();
  };

  const handleSavePrice = (name: string, price: string) => {
    if (!price.trim()) {
      toast.error("Ingrese un precio");
      return;
    }
    const updated = { ...prices, [name]: price };
    saveToStorage(updated);
    setEditingItem(null);
    setEditPrice("");
    toast.success(`Precio guardado para ${name}`);
  };

  const handleDeletePrice = (name: string) => {
    const updated = { ...prices };
    delete updated[name];
    saveToStorage(updated);
    toast.success(`Precio eliminado para ${name}`);
  };

  const handleAddNewItem = () => {
    if (!newItemName.trim() || !newItemPrice.trim()) {
      toast.error("Complete todos los campos");
      return;
    }
    const updated = { ...prices, [newItemName]: newItemPrice };
    saveToStorage(updated);
    setNewItemName("");
    setNewItemPrice("");
    toast.success(`Precio agregado para ${newItemName}`);
  };

  // Obtener lista de items a mostrar
  const getItems = (): { name: string; rateLimit?: string }[] => {
    if (useSimpleQueues) {
      return speeds.map(s => ({ name: s, rateLimit: s.replace('M', ' Mbps') }));
    } else {
      return plans;
    }
  };

  const items = getItems();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          Configurar Precios
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Configurar Precios de {useSimpleQueues ? "Velocidades" : "Planes"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info */}
          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
            Configure los precios para cada {useSimpleQueues ? "velocidad" : "plan"}. 
            Estos precios se cargarán automáticamente al seleccionar {useSimpleQueues ? "la velocidad" : "el plan"} en el formulario de registro.
          </div>

          {/* Tabla de precios */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{useSimpleQueues ? "Velocidad" : "Plan"}</TableHead>
                    {!useSimpleQueues && <TableHead>Velocidad</TableHead>}
                    <TableHead>Precio Mensual</TableHead>
                    <TableHead className="w-[100px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={useSimpleQueues ? 3 : 4} className="text-center text-muted-foreground py-8">
                        No hay {useSimpleQueues ? "velocidades" : "planes"} disponibles
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        {!useSimpleQueues && (
                          <TableCell className="text-muted-foreground">
                            {item.rateLimit || "-"}
                          </TableCell>
                        )}
                        <TableCell>
                          {editingItem === item.name ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                placeholder="Ej: $50.000"
                                className="h-8 w-32"
                                autoFocus
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => handleSavePrice(item.name, editPrice)}
                              >
                                <Check className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditingItem(null);
                                  setEditPrice("");
                                }}
                              >
                                <X className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          ) : prices[item.name] ? (
                            <span className="font-medium text-green-600 dark:text-green-400">
                              {prices[item.name]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">Sin precio</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingItem !== item.name && (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditingItem(item.name);
                                  setEditPrice(prices[item.name] || "");
                                }}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              {prices[item.name] && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeletePrice(item.name)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Agregar precio personalizado */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Agregar {useSimpleQueues ? "Velocidad" : "Plan"} Personalizado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="sr-only">Nombre</Label>
                  <Input
                    placeholder={useSimpleQueues ? "Ej: 150M" : "Ej: Plan Premium"}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Label className="sr-only">Precio</Label>
                  <Input
                    placeholder="Ej: $80.000"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                  />
                </div>
                <Button type="button" onClick={handleAddNewItem}>
                  Agregar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Resumen */}
          <div className="flex justify-between items-center text-sm text-muted-foreground pt-2 border-t">
            <span>
              {Object.keys(prices).length} precios configurados
            </span>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
