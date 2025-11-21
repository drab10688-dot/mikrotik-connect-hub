import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Ban, Shield, AlertCircle, ListPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const AddressList = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCreateListDialogOpen, setIsCreateListDialogOpen] = useState(false);
  const [deleteListName, setDeleteListName] = useState<string | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [formData, setFormData] = useState({
    addresses: "",
    list: "",
    comment: "",
  });
  const [newListName, setNewListName] = useState("");

  const { data: addressEntries, isLoading, refetch } = useQuery({
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
    refetchInterval: 5000,
  });

  // Agrupar entradas por lista
  const groupedByList = (addressEntries || []).reduce((acc: any, entry: any) => {
    const listName = entry.list || "Sin lista";
    if (!acc[listName]) {
      acc[listName] = [];
    }
    acc[listName].push(entry);
    return acc;
  }, {});

  // Obtener nombres de listas únicas
  const availableLists = Object.keys(groupedByList).sort();

  // Filtrar listas según búsqueda
  const filteredLists = availableLists.filter(listName => {
    const lowerSearch = searchTerm.toLowerCase();
    const matchesListName = listName.toLowerCase().includes(lowerSearch);
    const matchesIP = groupedByList[listName].some((entry: any) => 
      entry.address?.toLowerCase().includes(lowerSearch)
    );
    return matchesListName || matchesIP;
  });

  const expandIPRange = (input: string): string[] => {
    const lines = input.split("\n").filter(line => line.trim());
    const expandedIPs: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/);
      
      if (rangeMatch) {
        const [, startIP, endIP] = rangeMatch;
        const startParts = startIP.split('.').map(Number);
        const endParts = endIP.split('.').map(Number);
        
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
            expandedIPs.push(trimmed);
          }
        } else {
          expandedIPs.push(trimmed);
        }
      } else {
        expandedIPs.push(trimmed);
      }
    }

    return expandedIPs;
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) {
      toast.error("Ingresa un nombre para la lista");
      return;
    }

    if (availableLists.includes(newListName.trim())) {
      toast.error("Esta lista ya existe");
      return;
    }

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      // Crear una entrada dummy temporal para crear la lista
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: "address-list-add",
          params: {
            list: newListName.trim(),
            address: "0.0.0.0",
            comment: "Lista creada - eliminar esta entrada después de agregar IPs reales",
          },
        },
      });

      if (error) throw error;
      
      toast.success(`Lista "${newListName}" creada exitosamente`);
      setNewListName("");
      setIsCreateListDialogOpen(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al crear lista");
    }
  };

  const handleAddIPs = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.list.trim()) {
      toast.error("Selecciona una lista");
      return;
    }

    const loadingToast = toast.loading("Agregando IPs...");

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const addressList = isBulkMode 
        ? expandIPRange(formData.addresses)
        : formData.addresses.split("\n").filter(addr => addr.trim());
      
      if (addressList.length === 0) {
        toast.error("Ingresa al menos una dirección");
        toast.dismiss(loadingToast);
        return;
      }

      let successCount = 0;
      let duplicateCount = 0;

      for (const address of addressList) {
        try {
          const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
            body: {
              host: device.host,
              username: device.username,
              password: device.password,
              port: device.port,
              command: "address-list-add",
              params: {
                address: address.trim(),
                list: formData.list,
                comment: formData.comment || undefined,
              },
            },
          });

          if (error || (data && !data.success && data.error)) {
            const errorMsg = error?.message || data?.error || "";
            if (errorMsg.includes("already have such entry")) {
              duplicateCount++;
            }
          } else {
            successCount++;
          }
        } catch (err: any) {
          if (err?.message?.includes("already have such entry")) {
            duplicateCount++;
          }
        }
      }

      toast.dismiss(loadingToast);

      if (successCount > 0) {
        toast.success(`${successCount} IP(s) agregada(s) exitosamente`);
      }
      if (duplicateCount > 0) {
        toast.info(`${duplicateCount} IP(s) ya existían`);
      }
      
      setIsAddDialogOpen(false);
      setFormData({ addresses: "", list: "", comment: "" });
      setIsBulkMode(false);
      refetch();
    } catch (error: any) {
      toast.dismiss(loadingToast);
      toast.error(error.message || "Error al agregar IPs");
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: "address-list-remove",
          params: { ".id": entryId },
        },
      });

      if (error) throw error;
      
      toast.success("IP eliminada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar IP");
    }
  };

  const handleDeleteList = async () => {
    if (!deleteListName) return;

    const entriesToDelete = groupedByList[deleteListName] || [];
    
    if (entriesToDelete.length === 0) {
      toast.error("No hay entradas para eliminar");
      setDeleteListName(null);
      return;
    }

    const loadingToast = toast.loading(`Eliminando ${entriesToDelete.length} entrada(s)...`);

    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      let successCount = 0;

      for (const entry of entriesToDelete) {
        try {
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

          if (!error) successCount++;
        } catch {
          // Continuar con la siguiente
        }
      }

      toast.dismiss(loadingToast);
      toast.success(`Lista "${deleteListName}" eliminada - ${successCount} entrada(s) eliminada(s)`);
      setDeleteListName(null);
      refetch();
    } catch (error: any) {
      toast.dismiss(loadingToast);
      toast.error(error.message || "Error al eliminar lista");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Address Lists</h1>
          <p className="text-muted-foreground">Gestiona listas de direcciones IP bloqueadas o permitidas</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Listas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{availableLists.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total IPs Bloqueadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{addressEntries?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Listas Activas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{availableLists.filter(list => list !== "Sin lista").length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Gestión de Listas</CardTitle>
                <CardDescription>Administra tus address lists y las IPs bloqueadas</CardDescription>
              </div>
              <div className="flex gap-2">
                <Dialog open={isCreateListDialogOpen} onOpenChange={setIsCreateListDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <ListPlus className="w-4 h-4 mr-2" />
                      Nueva Lista
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Crear Nueva Lista</DialogTitle>
                      <DialogDescription>
                        Crea una nueva address list vacía
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="new-list-name">Nombre de la Lista *</Label>
                        <Input
                          id="new-list-name"
                          value={newListName}
                          onChange={(e) => setNewListName(e.target.value)}
                          placeholder="ej: Morosos, Bloqueados, VIP"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setIsCreateListDialogOpen(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleCreateList}>
                          <Plus className="w-4 h-4 mr-2" />
                          Crear Lista
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar IPs
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Agregar IPs a Lista</DialogTitle>
                      <DialogDescription>
                        Agrega una o varias direcciones IP a una lista existente
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddIPs} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="list-select">Lista Destino *</Label>
                        <select
                          id="list-select"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={formData.list}
                          onChange={(e) => setFormData({ ...formData, list: e.target.value })}
                          required
                        >
                          <option value="">Selecciona una lista</option>
                          {availableLists.map((list) => (
                            <option key={list} value={list}>{list}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="addresses">Direcciones IP *</Label>
                        <Textarea
                          id="addresses"
                          value={formData.addresses}
                          onChange={(e) => setFormData({ ...formData, addresses: e.target.value })}
                          placeholder={isBulkMode ? "192.168.100.2\n192.168.100.3\no rango:\n192.168.100.2 - 192.168.100.60" : "192.168.1.100"}
                          rows={isBulkMode ? 6 : 2}
                          required
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsBulkMode(!isBulkMode)}
                        >
                          {isBulkMode ? "Modo Simple" : "Modo Bloque/Rango"}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="comment">Comentario (Opcional)</Label>
                        <Input
                          id="comment"
                          value={formData.comment}
                          onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                          placeholder="Descripción o motivo"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" type="button" onClick={() => setIsAddDialogOpen(false)}>
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
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Buscar por nombre de lista o IP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="text-center p-8 text-muted-foreground">
                Cargando listas...
              </div>
            ) : filteredLists.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay listas configuradas</p>
              </div>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {filteredLists.map((listName) => {
                  const entries = groupedByList[listName];
                  const filteredEntries = searchTerm 
                    ? entries.filter((e: any) => e.address?.toLowerCase().includes(searchTerm.toLowerCase()))
                    : entries;

                  return (
                    <AccordionItem key={listName} value={listName} className="border rounded-lg px-4">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              {listName.toLowerCase().includes("moros") || listName.toLowerCase().includes("block") ? (
                                <Ban className="w-5 h-5 text-destructive" />
                              ) : (
                                <Shield className="w-5 h-5 text-primary" />
                              )}
                            </div>
                            <div className="text-left">
                              <div className="font-semibold">{listName}</div>
                              <div className="text-sm text-muted-foreground">
                                {entries.length} IP{entries.length !== 1 ? 's' : ''} en la lista
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteListName(listName);
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 pt-4">
                          {filteredEntries.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              No hay IPs que coincidan con la búsqueda
                            </p>
                          ) : (
                            filteredEntries.map((entry: any) => (
                              <div
                                key={entry[".id"]}
                                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                              >
                                <div className="flex-1">
                                  <div className="font-mono font-medium">{entry.address}</div>
                                  {entry.comment && (
                                    <div className="text-sm text-muted-foreground mt-1">
                                      {entry.comment}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteEntry(entry[".id"])}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteListName} onOpenChange={() => setDeleteListName(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar lista completa?</AlertDialogTitle>
              <AlertDialogDescription>
                Estás a punto de eliminar la lista "{deleteListName}" y todas sus {groupedByList[deleteListName || ""]?.length || 0} entrada(s).
                Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteList} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Eliminar Lista
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default AddressList;