import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Ban, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

const SimpleQueues = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    target: "",
    upload: "",
    download: "",
    comment: "",
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
      setFormData({ name: "", target: "", upload: "", download: "", comment: "" });
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
                      <td colSpan={6} className="text-center p-8 text-muted-foreground">
                        Cargando colas...
                      </td>
                    </tr>
                  ) : filteredQueues.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-muted-foreground">
                        No hay colas configuradas
                      </td>
                    </tr>
                  ) : (
                    filteredQueues.map((queue: any) => {
                      const isDisabled = queue.disabled === "true" || queue.disabled === true;
                      
                      return (
                        <tr key={queue[".id"]} className={`border-b hover:bg-muted/50 ${isDisabled ? 'opacity-50' : ''}`}>
                          <td className="p-4 font-medium">{queue.name}</td>
                          <td className="p-4 font-mono text-sm">{queue.target}</td>
                          <td className="p-4 text-sm">{queue["max-limit"] || "-"}</td>
                          <td className="p-4">
                            <Badge variant={isDisabled ? "secondary" : "default"}>
                              {isDisabled ? "Desactivado" : "Activo"}
                            </Badge>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">{queue.comment || "-"}</td>
                          <td className="p-4 text-right">
                            <div className="flex gap-1 justify-end">
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
