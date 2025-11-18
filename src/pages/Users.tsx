import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { useHotspotUsers } from "@/hooks/useMikrotikData";
import { removeHotspotUser } from "@/lib/mikrotik";
import { AddHotspotUserDialog } from "@/components/forms/AddHotspotUserDialog";

const Users = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: users, isLoading, refetch } = useHotspotUsers();

  const handleDelete = async (userId: string) => {
    try {
      await removeHotspotUser(userId);
      toast.success("Usuario eliminado correctamente");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar usuario");
    }
  };

  const handleExport = () => {
    if (!users) return;
    
    const csv = [
      ["Usuario", "Perfil", "Dirección", "Límite"].join(","),
      ...users.map((u: any) => 
        [u.name, u.profile || "default", u.address || "-", u["limit-uptime"] || "-"].join(",")
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hotspot-users-${new Date().toISOString()}.csv`;
    a.click();
    toast.success("Usuarios exportados");
  };

  const filteredUsers = users?.filter((u: any) => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.profile?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Usuarios Hotspot</h1>
          <p className="text-muted-foreground">Gestiona los usuarios del hotspot</p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Lista de Usuarios</CardTitle>
                <CardDescription>Usuarios del hotspot de MikroTik</CardDescription>
              </div>
              <div className="flex gap-2">
                <AddHotspotUserDialog onSuccess={refetch} />
                <Button onClick={handleExport} variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Exportar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuarios..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Usuario</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Perfil</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Estado</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Dirección</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Cargando usuarios...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No hay usuarios registrados
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user: any) => (
                      <tr key={user[".id"]} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium">{user.name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{user.profile || "default"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={user.disabled ? "destructive" : "default"}>
                            {user.disabled ? "Deshabilitado" : "Activo"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
                          {user.address || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(user[".id"])}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
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

export default Users;
