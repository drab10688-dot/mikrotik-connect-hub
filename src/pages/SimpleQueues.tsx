import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Ban, CheckCircle, ListPlus, ListX } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";

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

  const { data: queues, isLoading, refetch } = useQuery({
    queryKey: ["simple-queues"],
    queryFn: async () => {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "simple-queues",
          action: device.version === "v7" ? "list-queues" : undefined,
        },
      });

      if (error) throw error;
      // Filtrar objetos dinámicos que no se pueden editar
      const allQueues = data.data || [];
      return allQueues.filter((q: any) => q.dynamic !== "true" && q.dynamic !== true);
    },
    refetchInterval: 10000,
  });

  // Obtener address lists disponibles del MikroTik
  const { data: addressLists } = useQuery({
    queryKey: ["address-lists"],
    queryFn: async () => {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: "address-list-print",
        },
      });

      if (error) throw error;
      
      // Extraer nombres únicos de las address lists
      const lists = data.data || [];
      const uniqueLists = [...new Set(lists.map((item: any) => item.list))].filter(Boolean);
      return uniqueLists;
    },
    refetchInterval: 30000,
  });

  // Obtener todas las IPs en address-lists para mostrar estado de suspensión
  const { data: addressListEntries, refetch: refetchAddressLists } = useQuery({
    queryKey: ["address-list-entries"],
    queryFn: async () => {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: "address-list-print",
        },
      });

      if (error) throw error;
      return data.data || [];
    },
    refetchInterval: 5000, // Refetch cada 5 segundos para mantener actualizado
  });

  const validateBandwidth = (value: string): boolean => {
    // Formato válido: número seguido de k, M, o G (ej: 1M, 500k, 10M)
    const bandwidthRegex = /^\d+(\.\d+)?[kMG]$/;
    return bandwidthRegex.test(value.trim());
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      // Limpiar y validar valores
      const uploadValue = formData.upload.trim();
      const downloadValue = formData.download.trim();
      
      if (!uploadValue || !downloadValue) {
        toast.error("Los límites de upload y download son requeridos");
        return;
      }
      
      // Validar formato
      if (!validateBandwidth(uploadValue)) {
        toast.error("Formato inválido de upload. Use: número + k/M/G (ej: 5M, 500k, 1G)");
        return;
      }
      
      if (!validateBandwidth(downloadValue)) {
        toast.error("Formato inválido de download. Use: número + k/M/G (ej: 5M, 500k, 1G)");
        return;
      }
      
      // Formatear max-limit correctamente: upload/download (sin espacios)
      const maxLimit = `${uploadValue}/${downloadValue}`;
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "simple-queue-add",
          action: device.version === "v7" ? "add-queue" : undefined,
          params: {
            name: formData.name.trim(),
            target: formData.target.trim(),
            "max-limit": maxLimit,
            comment: formData.comment?.trim() || undefined,
          },
        },
      });

      if (error) throw error;
      
      toast.success("Cola agregada exitosamente");
      setIsDialogOpen(false);
      setFormData({ name: "", target: "", upload: "", download: "", comment: "", addressList: "" });
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al agregar cola");
    }
  };

  const handleDelete = async (queueId: string) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "simple-queue-remove",
          action: device.version === "v7" ? "remove-queue" : undefined,
          params: { ".id": queueId },
        },
      });

      if (error) throw error;
      
      toast.success("Cola eliminada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar cola");
    }
  };

  const handleToggle = async (queueId: string, currentlyDisabled: boolean) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      const command = currentlyDisabled ? "simple-queue-enable" : "simple-queue-disable";
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : command,
          action: device.version === "v7" ? (currentlyDisabled ? "enable-queue" : "disable-queue") : undefined,
          params: { ".id": queueId },
        },
      });

      if (error) throw error;
      
      toast.success(currentlyDisabled ? "Cola activada" : "Cola desactivada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al modificar cola");
    }
  };

  const handleAddToAddressList = async (queue: any, listName: string) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      // Usar "Morosos" si seleccionó crear nueva lista
      const finalListName = listName === "__nuevo__" ? "Morosos" : listName;
      
      // Normalizar IP para comparación (remover /32 al final si existe)
      const normalizeIP = (ip: string) => ip.replace(/\/32$/, '');
      const targetIP = normalizeIP(queue.target);
      
      // Verificar si la IP ya está en la lista (comparando IPs normalizadas)
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
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: "address-list-add",
          params: {
            list: finalListName,
            address: queue.target,
            comment: `Suspensión: ${queue.name}${queue.comment ? ' - ' + queue.comment : ''}`,
          },
        },
      });

      // Verificar si hay error en la respuesta data
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
      
      // Forzar actualización inmediata de los datos
      await Promise.all([refetch(), refetchAddressLists()]);
      
      toast.success(`Usuario bloqueado - IP agregada a "${finalListName}"`);
    } catch (error: any) {
      console.error("Error al agregar a address-list:", error);
      
      // Manejar el caso específico de entrada duplicada
      const errorMsg = error.message || JSON.stringify(error);
      if (errorMsg.includes("already have such entry")) {
        toast.warning(`Esta IP ya existe en la lista`);
      } else {
        toast.error(errorMsg || "Error al agregar a address-list");
      }
    }
  };

  const handleRemoveFromAddressList = async (queue: any) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      // Normalizar IP para comparación (remover /32, /24, etc.)
      const normalizeIP = (ip: string) => ip.split('/')[0];
      const targetIP = normalizeIP(queue.target);
      
      // Buscar todas las entradas de address-list que coincidan con esta IP (normalizadas)
      const entries = addressListEntries?.filter((entry: any) => {
        const entryIP = normalizeIP(entry.address || '');
        return entryIP === targetIP;
      });

      if (!entries || entries.length === 0) {
        toast.info("Esta IP no está en ninguna lista");
        return;
      }

      // Remover todas las entradas encontradas
      let removedCount = 0;
      for (const entry of entries) {
        const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
          body: {
            host: device.host,
            username: device.username,
            password: device.password,
            port: device.port,
            command: "address-list-remove",
            params: { ".id": entry[".id"] },
          },
        });
        
        if (!error) {
          removedCount++;
        }
      }
      
      // Forzar actualización inmediata de los datos
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

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      const finalListName = listName === "__nuevo__" ? "Morosos" : listName;
      
      // Normalizar IP para comparación
      const normalizeIP = (ip: string) => ip.replace(/\/32$/, '');
      
      let added = 0;
      let skipped = 0;

      for (const queueId of selectedQueues) {
        const queue = queues?.find((q: any) => q[".id"] === queueId);
        if (!queue) continue;

        const targetIP = normalizeIP(queue.target);

        // Verificar si ya está en la lista
        const alreadyInList = addressListEntries?.some((entry: any) => {
          const entryIP = normalizeIP(entry.address);
          return entryIP === targetIP && entry.list.toLowerCase() === finalListName.toLowerCase();
        });

        if (alreadyInList) {
          skipped++;
          continue;
        }

        try {
          const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
            body: {
              host: device.host,
              username: device.username,
              password: device.password,
              port: device.port,
              command: "address-list-add",
              params: {
                list: finalListName,
                address: queue.target,
                comment: `Suspensión: ${queue.name}${queue.comment ? ' - ' + queue.comment : ''}`,
              },
            },
          });

          // Verificar si hay error en data
          const hasError = (data && !data.success) || error;
          const errorMsg = (data?.error || error?.message || "").toLowerCase();
          
          if (hasError && errorMsg.includes("already have such entry")) {
            skipped++;
          } else if (!hasError) {
            added++;
          } else {
            skipped++;
            console.error("Error adding IP:", data?.error || error?.message);
          }
        } catch (err: any) {
          console.error("Error adding IP:", err);
          const errMsg = (err.message || "").toLowerCase();
          if (errMsg.includes("already have such entry")) {
            skipped++;
          } else {
            skipped++;
          }
        }
      }
      
      if (added > 0 && skipped > 0) {
        toast.success(`${added} IPs agregadas a "${finalListName}" (${skipped} ya existían)`);
      } else if (added > 0) {
        toast.success(`${added} IPs agregadas a "${finalListName}"`);
      } else {
        toast.info(`Todas las IPs ya estaban en "${finalListName}"`);
      }
      
      setSelectedQueues([]);
    } catch (error: any) {
      console.error("Error al agregar en bloque:", error);
      toast.error(error.message || "Error al agregar en bloque");
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
    
    // Normalizar IP para comparación (remover /32, /24, etc.)
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

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Simple Queues</h1>
          <p className="text-muted-foreground">Administra colas de ancho de banda</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Colas Simples</CardTitle>
                <CardDescription>Control de ancho de banda por usuario/IP</CardDescription>
              </div>
              <div className="flex gap-2">
                {selectedQueues.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary">
                        <ListPlus className="w-4 h-4 mr-2" />
                        Agregar {selectedQueues.length} a lista
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <div className="px-2 py-1.5 text-sm font-semibold">
                        Agregar seleccionados a:
                      </div>
                      <DropdownMenuSeparator />
                      {addressLists && addressLists.length > 0 ? (
                        addressLists.map((list: string) => (
                          <DropdownMenuItem
                            key={list}
                            onClick={() => handleBulkAddToList(list)}
                          >
                            {list}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>
                          No hay listas disponibles
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleBulkAddToList("__nuevo__")}
                        className="text-primary"
                      >
                        + Nueva lista: Morosos
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
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
                          placeholder="Cliente01"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="target">Target (IP/Red) *</Label>
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
                          <Label htmlFor="upload">Límite de Subida *</Label>
                          <Input
                            id="upload"
                            value={formData.upload}
                            onChange={(e) => {
                              // Permitir solo números, punto, k, M, G y convertir a mayúsculas
                              const value = e.target.value
                                .replace(/[^0-9.kmgKMG]/g, '')
                                .toUpperCase();
                              setFormData({ ...formData, upload: value });
                            }}
                            placeholder="5M"
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            Formato: número + k/M/G (ej: 1M, 500k, 2G)
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="download">Límite de Descarga *</Label>
                          <Input
                            id="download"
                            value={formData.download}
                            onChange={(e) => {
                              // Permitir solo números, punto, k, M, G y convertir a mayúsculas
                              const value = e.target.value
                                .replace(/[^0-9.kmgKMG]/g, '')
                                .toUpperCase();
                              setFormData({ ...formData, download: value });
                            }}
                            placeholder="10M"
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            Formato: número + k/M/G (ej: 1M, 500k, 2G)
                          </p>
                        </div>
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
                        checked={selectedQueues.length === filteredQueues.length && filteredQueues.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left p-4 font-medium">Nombre</th>
                    <th className="text-left p-4 font-medium">Target</th>
                    <th className="text-left p-4 font-medium">Max Limit</th>
                    <th className="text-left p-4 font-medium">Estado</th>
                    <th className="text-left p-4 font-medium">Comentario</th>
                    <th className="text-right p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-muted-foreground">
                        Cargando colas...
                      </td>
                    </tr>
                  ) : filteredQueues.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-muted-foreground">
                        No hay colas configuradas
                      </td>
                    </tr>
                  ) : (
                    filteredQueues.map((queue: any) => {
                      const isDisabled = queue.disabled === "true" || queue.disabled === true;
                      const isSelected = selectedQueues.includes(queue[".id"]);
                      const isSuspended = isInAddressList(queue.target);
                      
                      return (
                        <tr key={queue[".id"]} className={`border-b hover:bg-muted/50 ${isDisabled ? 'opacity-50' : ''}`}>
                          <td className="p-4">
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
                          <td className="p-4 font-medium">{queue.name}</td>
                          <td className="p-4 font-mono text-sm">{queue.target}</td>
                          <td className="p-4 text-sm">{queue["max-limit"] || "-"}</td>
                          <td className="p-4">
                            <div className="flex gap-2">
                              {isSuspended ? (
                                <Badge variant="destructive" className="flex items-center gap-1">
                                  <Ban className="w-3 h-3" />
                                  Usuario Moroso
                                </Badge>
                              ) : (
                                <Badge variant="default" className="flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Activo
                                </Badge>
                              )}
                              {isDisabled && (
                                <Badge variant="secondary">
                                  Desactivado
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">{queue.comment || "-"}</td>
                          <td className="p-4 text-right">
                            <div className="flex gap-1 justify-end">
                              {!isSuspended && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAddToAddressList(queue, "Morosos")}
                                  title="Bloquear por morosidad"
                                  className="text-red-600 border-red-600 hover:bg-red-50"
                                >
                                  <Ban className="w-4 h-4 mr-1" />
                                  Bloquear
                                </Button>
                              )}
                              {isSuspended && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRemoveFromAddressList(queue)}
                                  title="Reactivar servicio"
                                  className="text-green-600 border-green-600 hover:bg-green-50"
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Reactivar
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggle(queue[".id"], isDisabled)}
                                title={isDisabled ? "Activar" : "Desactivar"}
                              >
                                {isDisabled ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Ban className="w-4 h-4 text-orange-500" />
                                )}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Gestionar Address List"
                                  >
                                    <ListPlus className="w-4 h-4 text-orange-500" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  <div className="px-2 py-1.5 text-sm font-semibold">
                                    Agregar a lista:
                                  </div>
                                  <DropdownMenuSeparator />
                                  {addressLists && addressLists.length > 0 ? (
                                    addressLists.map((list: string) => (
                                      <DropdownMenuItem
                                        key={list}
                                        onClick={() => handleAddToAddressList(queue, list)}
                                      >
                                        {list}
                                      </DropdownMenuItem>
                                    ))
                                  ) : (
                                    <DropdownMenuItem disabled>
                                      No hay listas disponibles
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleAddToAddressList(queue, "__nuevo__")}
                                    className="text-primary"
                                  >
                                    + Nueva lista: Morosos
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(queue[".id"])}
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

export default SimpleQueues;
