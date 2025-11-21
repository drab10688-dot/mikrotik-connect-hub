import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

const AddressList = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    addresses: "",
    list: "",
    comment: "",
  });

  const { data: addresses, isLoading, refetch } = useQuery({
    queryKey: ["address-list"],
    queryFn: async () => {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "address-list-print",
          action: device.version === "v7" ? "list-address" : undefined,
        },
      });

      if (error) throw error;
      // Filtrar objetos dinámicos que no se pueden editar
      const allAddresses = data.data || [];
      return allAddresses.filter((a: any) => a.dynamic !== "true" && a.dynamic !== true);
    },
    refetchInterval: 10000,
  });

  // Obtener listas únicas del MikroTik
  const availableLists = Array.from(
    new Set((addresses || []).map((addr: any) => addr.list).filter(Boolean))
  ).sort();

  const expandIPRange = (input: string): string[] => {
    const lines = input.split("\n").filter(line => line.trim());
    const expandedIPs: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detectar si es un rango (formato: IP1 - IP2 o IP1-IP2)
      const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/);
      
      if (rangeMatch) {
        const [, startIP, endIP] = rangeMatch;
        const startParts = startIP.split('.').map(Number);
        const endParts = endIP.split('.').map(Number);
        
        // Validar que sean del mismo segmento de red (mismos primeros 3 octetos)
        if (startParts[0] === endParts[0] && 
            startParts[1] === endParts[1] && 
            startParts[2] === endParts[2]) {
          
          const start = startParts[3];
          const end = endParts[3];
          
          if (start <= end && end <= 255) {
            for (let i = start; i <= end; i++) {
              expandedIPs.push(`${startParts[0]}.${startParts[1]}.${startParts[2]}.${i}`);
            }
          } else {
            expandedIPs.push(trimmed); // Si el rango es inválido, agregar como está
          }
        } else {
          expandedIPs.push(trimmed); // Si no es el mismo segmento, agregar como está
        }
      } else {
        // No es un rango, agregar la IP individual
        expandedIPs.push(trimmed);
      }
    }

    return expandedIPs;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.list.trim()) {
      toast.error("Debes seleccionar o escribir una lista");
      return;
    }

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      // Expandir rangos si está en modo bloque
      const addressList = isBulkMode 
        ? expandIPRange(formData.addresses)
        : formData.addresses.split("\n").filter(addr => addr.trim());
      
      if (addressList.length === 0) {
        toast.error("Ingresa al menos una dirección");
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const address of addressList) {
        try {
          const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
            body: {
              host: device.host,
              username: device.username,
              password: device.password,
              port: device.port,
              command: device.version === "v7" ? undefined : "address-list-add",
              action: device.version === "v7" ? "add-address" : undefined,
              params: {
                address: address.trim(),
                list: formData.list,
                comment: formData.comment || undefined,
              },
            },
          });

          if (error) throw error;
          successCount++;
        } catch {
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} dirección(es) agregada(s) exitosamente`);
      }
      if (errorCount > 0) {
        toast.error(`${errorCount} dirección(es) fallaron`);
      }
      
      setIsDialogOpen(false);
      setFormData({ addresses: "", list: "", comment: "" });
      setIsBulkMode(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al agregar dirección");
    }
  };

  const handleToggle = async (addressId: string, currentDisabled: boolean) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : (currentDisabled ? "address-list-enable" : "address-list-disable"),
          action: device.version === "v7" ? (currentDisabled ? "enable-address" : "disable-address") : undefined,
          params: { ".id": addressId },
        },
      });

      if (error) throw error;
      
      toast.success(currentDisabled ? "Dirección activada" : "Dirección desactivada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al cambiar estado");
    }
  };

  const handleDelete = async (addressId: string) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "address-list-remove",
          action: device.version === "v7" ? "remove-address" : undefined,
          params: { ".id": addressId },
        },
      });

      if (error) throw error;
      
      toast.success("Dirección eliminada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar dirección");
    }
  };

  const handleBulkAction = async (action: "enable" | "disable" | "delete") => {
    if (selectedIds.length === 0) {
      toast.error("Selecciona al menos una dirección");
      return;
    }

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      let successCount = 0;

      for (const id of selectedIds) {
        try {
          let command = "";
          let actionV7 = "";

          if (action === "enable") {
            command = "address-list-enable";
            actionV7 = "enable-address";
          } else if (action === "disable") {
            command = "address-list-disable";
            actionV7 = "disable-address";
          } else {
            command = "address-list-remove";
            actionV7 = "remove-address";
          }

          const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
            body: {
              host: device.host,
              username: device.username,
              password: device.password,
              port: device.port,
              command: device.version === "v7" ? undefined : command,
              action: device.version === "v7" ? actionV7 : undefined,
              params: { ".id": id },
            },
          });

          if (!error) successCount++;
        } catch {
          // Continue with next
        }
      }

      toast.success(`${successCount} dirección(es) procesada(s)`);
      setSelectedIds([]);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error en acción masiva");
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredAddresses.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAddresses.map((addr: any) => addr[".id"]));
    }
  };

  const filteredAddresses = addresses?.filter((addr: any) =>
    addr.address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    addr.list?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Address List</h1>
          <p className="text-muted-foreground">Administra listas de direcciones IP</p>
        </div>

        <Card>
          <CardHeader>
              <div className="flex items-center justify-between">
              <div>
                <CardTitle>Direcciones IP</CardTitle>
                <CardDescription>Lista de direcciones configuradas</CardDescription>
              </div>
              <div className="flex gap-2 items-center">
                {selectedIds.length > 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkAction("enable")}
                    >
                      <Power className="w-4 h-4 mr-2" />
                      Activar ({selectedIds.length})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkAction("disable")}
                    >
                      <PowerOff className="w-4 h-4 mr-2" />
                      Desactivar ({selectedIds.length})
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleBulkAction("delete")}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Eliminar ({selectedIds.length})
                    </Button>
                  </>
                )}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar Dirección
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Agregar Dirección IP</DialogTitle>
                      <DialogDescription>
                        Agrega una nueva dirección a la lista
                      </DialogDescription>
                    </DialogHeader>
                     <form onSubmit={handleAdd} className="space-y-4">
                       <div className="space-y-2">
                         <Label htmlFor="addresses">Direcciones IP *</Label>
                         <Textarea
                           id="addresses"
                           value={formData.addresses}
                           onChange={(e) => setFormData({ ...formData, addresses: e.target.value })}
                           placeholder={isBulkMode ? "192.168.100.2\n192.168.100.3\no un rango:\n192.168.100.2 - 192.168.100.60" : "192.168.1.100"}
                           rows={isBulkMode ? 6 : 2}
                           required
                         />
                         <div className="flex items-center justify-between">
                           <Button
                             type="button"
                             variant="outline"
                             size="sm"
                             onClick={() => setIsBulkMode(!isBulkMode)}
                           >
                             {isBulkMode ? "Modo Simple" : "Modo Bloque"}
                           </Button>
                           {isBulkMode && (
                             <span className="text-xs text-muted-foreground">
                               Formato rango: 192.168.100.2 - 192.168.100.60
                             </span>
                           )}
                         </div>
                       </div>
                       <div className="space-y-2">
                         <Label htmlFor="list">Lista *</Label>
                         {availableLists.length > 0 ? (
                           <Select
                             value={formData.list}
                             onValueChange={(value) => {
                               if (value === "__custom__") {
                                 setFormData({ ...formData, list: "" });
                               } else {
                                 setFormData({ ...formData, list: value });
                               }
                             }}
                           >
                             <SelectTrigger>
                               <SelectValue placeholder="Selecciona una lista" />
                             </SelectTrigger>
                             <SelectContent>
                               {availableLists.map((list: string) => (
                                 <SelectItem key={list} value={list}>
                                   {list}
                                 </SelectItem>
                               ))}
                               <SelectItem value="__custom__">
                                 + Crear nueva lista
                               </SelectItem>
                             </SelectContent>
                           </Select>
                         ) : (
                           <Input
                             id="list"
                             value={formData.list}
                             onChange={(e) => setFormData({ ...formData, list: e.target.value })}
                             placeholder="Nombre de la lista (ej: blocked, allowed)"
                             required
                           />
                         )}
                         {formData.list && !availableLists.includes(formData.list) && availableLists.length > 0 && (
                           <Input
                             id="custom-list"
                             value={formData.list}
                             onChange={(e) => setFormData({ ...formData, list: e.target.value })}
                             placeholder="Nombre de la nueva lista"
                             required
                           />
                         )}
                       </div>
                       <div className="space-y-2">
                         <Label htmlFor="comment">Comentario</Label>
                         <Input
                           id="comment"
                           value={formData.comment}
                           onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                           placeholder="Descripción opcional"
                         />
                       </div>
                       <div className="flex gap-2 justify-end">
                         <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                           Cancelar
                         </Button>
                         <Button type="submit">Agregar</Button>
                       </div>
                     </form>
                  </DialogContent>
                </Dialog>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-64"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 font-medium w-12">
                      <Checkbox
                        checked={selectedIds.length === filteredAddresses.length && filteredAddresses.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left p-4 font-medium">Estado</th>
                    <th className="text-left p-4 font-medium">Dirección</th>
                    <th className="text-left p-4 font-medium">Lista</th>
                    <th className="text-left p-4 font-medium">Comentario</th>
                    <th className="text-right p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-muted-foreground">
                        Cargando direcciones...
                      </td>
                    </tr>
                  ) : filteredAddresses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-muted-foreground">
                        No hay direcciones configuradas
                      </td>
                    </tr>
                  ) : (
                    filteredAddresses.map((addr: any) => {
                      const isDisabled = addr.disabled === "true" || addr.disabled === true;
                      const isSelected = selectedIds.includes(addr[".id"]);
                      
                      return (
                        <tr key={addr[".id"]} className="border-b hover:bg-muted/50">
                          <td className="p-4">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedIds([...selectedIds, addr[".id"]]);
                                } else {
                                  setSelectedIds(selectedIds.filter(id => id !== addr[".id"]));
                                }
                              }}
                            />
                          </td>
                          <td className="p-4">
                            <Badge variant={isDisabled ? "secondary" : "default"}>
                              {isDisabled ? "Inactivo" : "Activo"}
                            </Badge>
                          </td>
                          <td className="p-4 font-mono font-medium">{addr.address}</td>
                          <td className="p-4">{addr.list}</td>
                          <td className="p-4 text-sm text-muted-foreground">{addr.comment || "-"}</td>
                          <td className="p-4 text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggle(addr[".id"], isDisabled)}
                              >
                                {isDisabled ? (
                                  <Power className="w-4 h-4 text-green-500" />
                                ) : (
                                  <PowerOff className="w-4 h-4 text-orange-500" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(addr[".id"])}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AddressList;
