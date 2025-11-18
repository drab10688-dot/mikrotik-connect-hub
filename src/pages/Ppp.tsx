import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Activity } from "lucide-react";
import { toast } from "sonner";
import { usePPPoEUsers, usePPPoEActive } from "@/hooks/useMikrotikData";
import { removePPPoEUser } from "@/lib/mikrotik";

const Ppp = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: pppUsers, isLoading: loadingUsers, refetch: refetchUsers } = usePPPoEUsers();
  const { data: activeConnections, isLoading: loadingActive } = usePPPoEActive();

  const handleDelete = async (userId: string) => {
    try {
      await removePPPoEUser(userId);
      toast.success("Usuario PPPoE eliminado");
      refetchUsers();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar usuario");
    }
  };

  const filteredUsers = pppUsers?.filter((u: any) =>
    u.name?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Gestión PPPoE</h1>
          <p className="text-muted-foreground">Administra usuarios y conexiones PPPoE</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Usuarios</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingUsers ? "..." : (pppUsers?.length || 0)}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Conexiones Activas</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingActive ? "..." : (activeConnections?.length || 0)}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Desconectados</p>
                  <h3 className="text-3xl font-bold mt-2">
                    {loadingUsers || loadingActive ? "..." : 
                      ((pppUsers?.length || 0) - (activeConnections?.length || 0))}
                  </h3>
                </div>
                <div className="w-12 h-12 rounded-full bg-gray-500/10 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-gray-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Usuarios PPPoE</CardTitle>
                <CardDescription>Lista de secretos y credenciales PPPoE</CardDescription>
              </div>
              <div className="flex gap-2">
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
                    <th className="text-left p-4 font-medium">Usuario</th>
                    <th className="text-left p-4 font-medium">Servicio</th>
                    <th className="text-left p-4 font-medium">Perfil</th>
                    <th className="text-left p-4 font-medium">Dirección Local</th>
                    <th className="text-left p-4 font-medium">Dirección Remota</th>
                    <th className="text-left p-4 font-medium">Estado</th>
                    <th className="text-right p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-muted-foreground">
                        Cargando usuarios...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-muted-foreground">
                        No hay usuarios PPPoE configurados
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user: any) => {
                      const isActive = activeConnections?.some((conn: any) => 
                        conn.name === user.name
                      );
                      
                      return (
                        <tr key={user[".id"]} className="border-b hover:bg-muted/50">
                          <td className="p-4 font-medium">{user.name}</td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {user.service || "any"}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {user.profile || "default"}
                          </td>
                          <td className="p-4 text-sm font-mono">
                            {user["local-address"] || "-"}
                          </td>
                          <td className="p-4 text-sm font-mono">
                            {user["remote-address"] || "-"}
                          </td>
                          <td className="p-4">
                            <Badge variant={isActive ? "default" : "secondary"}>
                              {isActive ? "Conectado" : "Desconectado"}
                            </Badge>
                          </td>
                          <td className="p-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(user[".id"])}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
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

export default Ppp;
