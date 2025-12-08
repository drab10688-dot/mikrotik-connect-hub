import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Ban, CheckCircle, ListPlus, ListX, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { getSelectedDeviceId } from "@/lib/mikrotik";

const SimpleQueues = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedQueues, setSelectedQueues] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    target: "",
    upload: "",
    download: "",
    comment: "",
    addressList: "",
  });

  const mikrotikId = getSelectedDeviceId();

  const { data: queues, isLoading, refetch } = useQuery({
    queryKey: ["simple-queues", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "simple-queues",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      // Filtrar objetos dinámicos que no se pueden editar
      const allQueues = data.data || [];
      return allQueues.filter((q: any) => q.dynamic !== "true" && q.dynamic !== true);
    },
    enabled: !!mikrotikId,
    refetchInterval: 10000,
  });

  // Obtener address lists disponibles del MikroTik
  const { data: addressLists } = useQuery({
    queryKey: ["address-lists", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "address-list-print",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      // Extraer nombres únicos de las address lists
      const lists = data.data || [];
      const uniqueLists = [...new Set(lists.map((item: any) => item.list))].filter(Boolean);
      return uniqueLists;
    },
    enabled: !!mikrotikId,
    refetchInterval: 30000,
  });

  // Obtener todas las IPs en address-lists para mostrar estado de suspensión
  const { data: addressListEntries, refetch: refetchAddressLists } = useQuery({
    queryKey: ["address-list-entries", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "address-list-print",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data.data || [];
    },
    enabled: !!mikrotikId,
    refetchInterval: 5000,
  });

  const validateBandwidth = (value: string): boolean => {
    const bandwidthRegex = /^\d+(\.\d+)?[kMG]$/;
    return bandwidthRegex.test(value.trim());
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const uploadValue = formData.upload.trim();
      const downloadValue = formData.download.trim();
      
      if (!uploadValue || !downloadValue) {
        toast.error("Los límites de upload y download son requeridos");
        return;
      }
      
      if (!validateBandwidth(uploadValue)) {
        toast.error("Formato inválido de upload. Use: número + k/M/G (ej: 5M, 500k, 1G)");
        return;
      }
      
      if (!validateBandwidth(downloadValue)) {
        toast.error("Formato inválido de download. Use: número + k/M/G (ej: 5M, 500k, 1G)");
        return;
      }
      
      const maxLimit = `${uploadValue}/${downloadValue}`;
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "simple-queue-add",
          params: {
            name: formData.name.trim(),
            target: formData.target.trim(),
            "max-limit": maxLimit,
            comment: formData.comment?.trim() || undefined,
          },
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      toast.success("Cola agregada exitosamente");
      setIsDialogOpen(false);
      setFormData({ name: "", target: "", upload: "", download: "", comment: "", addressList: "" });
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al agregar cola");
    }
  };

  const handleDelete = async (queueId: string) => {
    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "simple-queue-remove",
          params: { ".id": queueId },
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      toast.success("Cola eliminada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar cola");
    }
  };

  const handleToggle = async (queueId: string, currentlyDisabled: boolean) => {
    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const command = currentlyDisabled ? "simple-queue-enable" : "simple-queue-disable";
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command,
          params: { ".id": queueId },
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      toast.success(currentlyDisabled ? "Cola activada" : "Cola desactivada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al modificar cola");
    }
  };

  const handleAddToAddressList = async (queue: any, listName: string) => {
    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const finalListName = listName === "__nuevo__" ? "Morosos" : listName;
      const normalizeIP = (ip: string) => ip.replace(/\/32$/, '');
      const targetIP = normalizeIP(queue.target);
      
      const alreadyInList = addressListEntries?.some((entry: any) => {
        const entryIP = normalizeIP(entry.address);
        return entryIP === targetIP && entry.list.toLowerCase() === finalListName.toLowerCase();
      });

      if (alreadyInList) {
        toast.info(`Esta IP ya está en la lista "${finalListName}"`);
        return;
      }
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "address-list-add",
          params: {
            list: finalListName,
            address: queue.target,
            comment: `Suspensión: ${queue.name}${queue.comment ? ' - ' + queue.comment : ''}`,
          },
        },
      });

      if (data && !data.success && data.error) {
        if (data.error.includes("already have such entry")) {
          toast.warning(`Esta IP ya existe en la lista "${finalListName}"`);
          return;
        }
        throw new Error(data.error);
      }

      if (error) {
        if (error.message && error.message.includes("already have such entry")) {
          toast.warning(`Esta IP ya existe en la lista "${finalListName}"`);
          return;
        }
        throw error;
      }
      
      await Promise.all([refetch(), refetchAddressLists()]);
      toast.success(`Usuario bloqueado - IP agregada a "${finalListName}"`);
    } catch (error: any) {
      console.error("Error al agregar a address-list:", error);
      const errorMsg = error.message || JSON.stringify(error);
      if (errorMsg.includes("already have such entry")) {
        toast.warning(`Esta IP ya existe en la lista`);
      } else {
        toast.error(errorMsg || "Error al agregar a address-list");
      }
    }
  };

  const handleRemoveFromAddressList = async (queue: any) => {
    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const normalizeIP = (ip: string) => ip.split('/')[0];
      const targetIP = normalizeIP(queue.target);
      
      const entries = addressListEntries?.filter((entry: any) => {
        const entryIP = normalizeIP(entry.address || '');
        return entryIP === targetIP;
      });

      if (!entries || entries.length === 0) {
        toast.info("Esta IP no está en ninguna lista");
        return;
      }

      let removedCount = 0;
      for (const entry of entries) {
        const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
          body: {
            mikrotikId,
            command: "address-list-remove",
            params: { ".id": entry[".id"] },
          },
        });
        
        if (!error && data?.success) {
          removedCount++;
        }
      }
      
      await Promise.all([refetch(), refetchAddressLists()]);
      toast.success(`Servicio reactivado - ${removedCount} entrada(s) eliminada(s)`);
    } catch (error: any) {
      toast.error(error.message || "Error al remover de address-list");
    }
  };

  const handleBulkAddToList = async (listName: string) => {
    if (selectedQueues.length === 0) {
      toast.error("Selecciona al menos una cola");
      return;
    }

    if (!mikrotikId) {
      toast.error("No hay dispositivo MikroTik seleccionado");
      return;
    }

    try {
      const finalListName = listName === "__nuevo__" ? "Morosos" : listName;
      const normalizeIP = (ip: string) => ip.split('/')[0];
      
      let added = 0;
      let skipped = 0;

      for (const queueId of selectedQueues) {
        const queue = queues?.find((q: any) => q[".id"] === queueId);
        if (!queue) continue;

        const targetIP = normalizeIP(queue.target);

        const alreadyInList = addressListEntries?.some((entry: any) => {
          const entryIP = normalizeIP(entry.address || '');
          return entryIP === targetIP && entry.list.toLowerCase() === finalListName.toLowerCase();
        });

        if (alreadyInList) {
          skipped++;
          continue;
        }

        try {
          const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
            body: {
              mikrotikId,
              command: "address-list-add",
              params: {
                list: finalListName,
                address: queue.target,
                comment: `Suspensión: ${queue.name}${queue.comment ? ' - ' + queue.comment : ''}`,
              },
            },
          });

          const hasError = (data && !data.success) || error;
          const errorMsg = (data?.error || error?.message || "").toLowerCase();
          
          if (hasError && errorMsg.includes("already have such entry")) {
            skipped++;
          } else if (!hasError) {
            added++;
          } else {
            skipped++;
          }
        } catch (err: any) {
          const errMsg = (err?.message || "").toLowerCase();
          if (errMsg.includes("already have such entry")) {
            skipped++;
          } else {
            skipped++;
          }
        }
      }
      
      await Promise.all([refetch(), refetchAddressLists()]);
      
      if (added > 0 && skipped > 0) {
        toast.success(`${added} IPs agregadas a "${finalListName}" (${skipped} ya existían)`);
      } else if (added > 0) {
        toast.success(`${added} IPs agregadas a "${finalListName}"`);
      } else {
        toast.info(`Todas las IPs ya estaban en "${finalListName}"`);
      }
      
      setSelectedQueues([]);
    } catch (error: any) {
      toast.error(error.message || "Error al agregar en lote");
    }
  };

  const toggleSelectAll = () => {
    if (selectedQueues.length === filteredQueues.length) {
      setSelectedQueues([]);
    } else {
      setSelectedQueues(filteredQueues.map((q: any) => q[".id"]));
    }
  };

  const isInAddressList = (target: string) => {
    if (!addressListEntries) return false;
    const normalizeIP = (ip: string) => ip.split('/')[0];
    const targetIP = normalizeIP(target);
    
    return addressListEntries.some((entry: any) => {
      const entryIP = normalizeIP(entry.address || '');
      return entryIP === targetIP;
    });
  };

  const filteredQueues = queues?.filter((queue: any) =>
    queue.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    queue.target?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (!mikrotikId) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="p-4 md:p-8 md:ml-64">
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Sin conexión</h3>
                <p className="text-muted-foreground">
                  Conecta un dispositivo MikroTik desde Configuración
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Simple Queues</h1>
          <p className="text-muted-foreground">Administra colas de ancho de banda</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Colas Simples</CardTitle>
                <CardDescription>Control de ancho de banda por usuario/IP</CardDescription>
              </div>
              <div className="flex gap-2 items-center">
                {selectedQueues.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg border border-primary/20">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-primary">
                        {selectedQueues.length} seleccionado{selectedQueues.length !== 1 ? 's' : ''} - Elige una address list para bloquear
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="secondary">
                          <ListPlus className="w-4 h-4 mr-2" />
                          Agregar a Lista
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 bg-popover z-50">
                        <div className="px-2 py-1.5 text-sm font-semibold">
                          Agregar seleccionados a:
                        </div>
                        <DropdownMenuSeparator />
                        {addressLists && addressLists.length > 0 ? (
                          addressLists.map((list: string) => (
                            <DropdownMenuItem 
                              key={list} 
                              onClick={() => handleBulkAddToList(list)}
                              className="cursor-pointer"
                            >
                              <Ban className="w-4 h-4 mr-2" />
                              {list}
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <DropdownMenuItem 
                            onClick={() => handleBulkAddToList("__nuevo__")}
                            className="cursor-pointer"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Crear lista "Morosos"
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setSelectedQueues([])}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Agregar Cola
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Agregar Simple Queue</DialogTitle>
                        <DialogDescription>
                          Crea una nueva cola de ancho de banda
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleAdd} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="name">Nombre *</Label>
                          <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Cliente-001"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="target">Target (IP) *</Label>
                          <Input
                            id="target"
                            value={formData.target}
                            onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                            placeholder="192.168.1.100/32"
                            required
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="upload">Upload Limit *</Label>
                            <Input
                              id="upload"
                              value={formData.upload}
                              onChange={(e) => setFormData({ ...formData, upload: e.target.value })}
                              placeholder="5M"
                            />
                            <p className="text-xs text-muted-foreground">Ej: 5M, 500k, 1G</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="download">Download Limit *</Label>
                            <Input
                              id="download"
                              value={formData.download}
                              onChange={(e) => setFormData({ ...formData, download: e.target.value })}
                              placeholder="10M"
                            />
                            <p className="text-xs text-muted-foreground">Ej: 10M, 1G, 100k</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="comment">Comentario</Label>
                          <Input
                            id="comment"
                            value={formData.comment}
                            onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                            placeholder="Opcional"
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                          </Button>
                          <Button type="submit">
                            <Plus className="w-4 h-4 mr-2" />
                            Agregar
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Buscar por nombre o IP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              {filteredQueues.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {selectedQueues.length === filteredQueues.length ? "Deseleccionar todo" : "Seleccionar todo"}
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="text-center p-8 text-muted-foreground">
                Cargando colas...
              </div>
            ) : filteredQueues.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                No hay colas configuradas
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 w-10">
                        <Checkbox 
                          checked={selectedQueues.length === filteredQueues.length && filteredQueues.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="p-3 text-left text-sm font-medium">Nombre</th>
                      <th className="p-3 text-left text-sm font-medium">Target</th>
                      <th className="p-3 text-left text-sm font-medium">Max Limit</th>
                      <th className="p-3 text-left text-sm font-medium">Estado</th>
                      <th className="p-3 text-left text-sm font-medium">Comentario</th>
                      <th className="p-3 text-right text-sm font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQueues.map((queue: any) => {
                      const isDisabled = queue.disabled === "true" || queue.disabled === true;
                      const isSuspended = isInAddressList(queue.target);
                      const isSelected = selectedQueues.includes(queue[".id"]);
                      
                      return (
                        <tr 
                          key={queue[".id"]} 
                          className={`border-b last:border-0 ${isSelected ? 'bg-primary/5' : ''} ${isSuspended ? 'bg-destructive/5' : ''}`}
                        >
                          <td className="p-3">
                            <Checkbox 
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedQueues([...selectedQueues, queue[".id"]]);
                                } else {
                                  setSelectedQueues(selectedQueues.filter(id => id !== queue[".id"]));
                                }
                              }}
                            />
                          </td>
                          <td className="p-3 font-medium">{queue.name}</td>
                          <td className="p-3 font-mono text-sm">{queue.target}</td>
                          <td className="p-3 text-sm">{queue["max-limit"] || "-"}</td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              <Badge variant={isDisabled ? "secondary" : "default"}>
                                {isDisabled ? "Deshabilitada" : "Activa"}
                              </Badge>
                              {isSuspended && (
                                <Badge variant="destructive">
                                  Suspendido
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">{queue.comment || "-"}</td>
                          <td className="p-3">
                            <div className="flex gap-1 justify-end">
                              {isSuspended ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRemoveFromAddressList(queue)}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Reactivar
                                </Button>
                              ) : (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                      <Ban className="w-4 h-4 mr-1" />
                                      Suspender
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-popover z-50">
                                    <div className="px-2 py-1.5 text-sm font-semibold">
                                      Agregar IP a lista:
                                    </div>
                                    <DropdownMenuSeparator />
                                    {addressLists && addressLists.length > 0 ? (
                                      addressLists.map((list: string) => (
                                        <DropdownMenuItem 
                                          key={list} 
                                          onClick={() => handleAddToAddressList(queue, list)}
                                          className="cursor-pointer"
                                        >
                                          <ListPlus className="w-4 h-4 mr-2" />
                                          {list}
                                        </DropdownMenuItem>
                                      ))
                                    ) : (
                                      <DropdownMenuItem 
                                        onClick={() => handleAddToAddressList(queue, "__nuevo__")}
                                        className="cursor-pointer"
                                      >
                                        <Plus className="w-4 h-4 mr-2" />
                                        Crear lista "Morosos"
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggle(queue[".id"], isDisabled)}
                              >
                                {isDisabled ? "Habilitar" : "Deshabilitar"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(queue[".id"])}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SimpleQueues;
