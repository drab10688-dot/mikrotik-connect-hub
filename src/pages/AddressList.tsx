import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const AddressList = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    address: "",
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
          command: device.version === "v7" ? undefined : "firewall-address-list",
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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const device = JSON.parse(localStorage.getItem("mikrotik_config") || "{}");
      
      const { error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === "v7" ? undefined : "firewall-address-list-add",
          action: device.version === "v7" ? "add-address" : undefined,
          params: {
            address: formData.address,
            list: formData.list,
            comment: formData.comment || undefined,
          },
        },
      });

      if (error) throw error;
      
      toast.success("Dirección agregada exitosamente");
      setIsDialogOpen(false);
      setFormData({ address: "", list: "", comment: "" });
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al agregar dirección");
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
          command: device.version === "v7" ? undefined : "firewall-address-list-remove",
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
              <div className="flex gap-2">
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
                        <Label htmlFor="address">Dirección IP *</Label>
                        <Input
                          id="address"
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          placeholder="192.168.1.100"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="list">Lista *</Label>
                        <Input
                          id="list"
                          value={formData.list}
                          onChange={(e) => setFormData({ ...formData, list: e.target.value })}
                          placeholder="blocked, allowed, etc."
                          required
                        />
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
                    <th className="text-left p-4 font-medium">Dirección</th>
                    <th className="text-left p-4 font-medium">Lista</th>
                    <th className="text-left p-4 font-medium">Comentario</th>
                    <th className="text-right p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-muted-foreground">
                        Cargando direcciones...
                      </td>
                    </tr>
                  ) : filteredAddresses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center p-8 text-muted-foreground">
                        No hay direcciones configuradas
                      </td>
                    </tr>
                  ) : (
                    filteredAddresses.map((addr: any) => (
                      <tr key={addr[".id"]} className="border-b hover:bg-muted/50">
                        <td className="p-4 font-mono font-medium">{addr.address}</td>
                        <td className="p-4">{addr.list}</td>
                        <td className="p-4 text-sm text-muted-foreground">{addr.comment || "-"}</td>
                        <td className="p-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(addr[".id"])}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))
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
