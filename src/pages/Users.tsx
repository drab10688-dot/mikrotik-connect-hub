import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2, Edit, Download } from "lucide-react";
import { toast } from "sonner";

const Users = () => {
  const [searchTerm, setSearchTerm] = useState("");

  const users = [
    { id: 1, username: "user_001", password: "abc123", profile: "1_HORA", status: "unused", created: "2024-01-15" },
    { id: 2, username: "user_002", password: "def456", profile: "3_HORAS", status: "active", created: "2024-01-15" },
    { id: 3, username: "user_003", password: "ghi789", profile: "1_DIA", status: "unused", created: "2024-01-16" },
    { id: 4, username: "user_004", password: "jkl012", profile: "1_SEMANA", status: "expired", created: "2024-01-10" },
    { id: 5, username: "user_005", password: "mno345", profile: "1_MES", status: "active", created: "2024-01-14" },
  ];

  const handleDelete = (id: number) => {
    toast.success("Usuario eliminado correctamente");
  };

  const handleGenerate = () => {
    toast.success("Generando vouchers...");
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Usuarios Hotspot</h1>
          <p className="text-muted-foreground">Gestiona los usuarios y vouchers del hotspot</p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Lista de Usuarios</CardTitle>
                <CardDescription>Usuarios creados para el hotspot de MikroTik</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleGenerate}>
                  <Plus className="w-4 h-4 mr-2" />
                  Generar Usuarios
                </Button>
                <Button variant="outline">
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
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Contraseña</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Perfil</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Estado</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-foreground">Creado</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium">{user.username}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{user.password}</td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant="outline">{user.profile}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {user.status === "active" && (
                          <Badge className="bg-success/10 text-success border-success/20">Activo</Badge>
                        )}
                        {user.status === "unused" && (
                          <Badge className="bg-warning/10 text-warning border-warning/20">Sin usar</Badge>
                        )}
                        {user.status === "expired" && (
                          <Badge className="bg-destructive/10 text-destructive border-destructive/20">Expirado</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{user.created}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <Button variant="ghost" size="sm">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(user.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
