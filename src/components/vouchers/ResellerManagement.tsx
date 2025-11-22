import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2, DollarSign } from "lucide-react";
import { useResellers } from "@/hooks/useResellers";

interface ResellerManagementProps {
  mikrotikId: string;
}

export function ResellerManagement({ mikrotikId }: ResellerManagementProps) {
  const { assignments, isLoading, createReseller, isCreating, updateCommission, removeAssignment } = useResellers(mikrotikId);
  const [open, setOpen] = useState(false);
  const [editingCommission, setEditingCommission] = useState<string | null>(null);
  const [newReseller, setNewReseller] = useState({
    email: "",
    password: "",
    fullName: "",
    commissionPercentage: 0,
  });

  const handleCreate = () => {
    if (!newReseller.email || !newReseller.password || !newReseller.fullName) {
      return;
    }

    createReseller({
      email: newReseller.email,
      password: newReseller.password,
      fullName: newReseller.fullName,
      mikrotikId,
      commissionPercentage: newReseller.commissionPercentage,
    });

    setNewReseller({ email: "", password: "", fullName: "", commissionPercentage: 0 });
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Gestión de Resellers</CardTitle>
            <CardDescription>Administra usuarios que pueden vender vouchers</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-4 w-4 mr-2" />
                Nuevo Reseller
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Reseller</DialogTitle>
                <DialogDescription>
                  Crea un nuevo usuario con permisos para vender vouchers
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input
                    id="fullName"
                    value={newReseller.fullName}
                    onChange={(e) => setNewReseller({ ...newReseller, fullName: e.target.value })}
                    placeholder="Juan Pérez"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newReseller.email}
                    onChange={(e) => setNewReseller({ ...newReseller, email: e.target.value })}
                    placeholder="reseller@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newReseller.password}
                    onChange={(e) => setNewReseller({ ...newReseller, password: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commission">Comisión (%)</Label>
                  <Input
                    id="commission"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={newReseller.commissionPercentage}
                    onChange={(e) => setNewReseller({ ...newReseller, commissionPercentage: parseFloat(e.target.value) || 0 })}
                    placeholder="10"
                  />
                </div>
                <Button onClick={handleCreate} disabled={isCreating} className="w-full">
                  {isCreating ? 'Creando...' : 'Crear Reseller'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando resellers...</div>
        ) : assignments && assignments.length > 0 ? (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Comisión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment: any) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-medium">
                      {assignment.reseller?.full_name || 'Sin nombre'}
                    </TableCell>
                    <TableCell>{assignment.reseller?.email}</TableCell>
                    <TableCell>
                      {editingCommission === assignment.id ? (
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            defaultValue={assignment.commission_percentage}
                            className="w-20"
                            onBlur={(e) => {
                              updateCommission({
                                assignmentId: assignment.id,
                                commission: parseFloat(e.target.value) || 0,
                              });
                              setEditingCommission(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            autoFocus
                          />
                          <span>%</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingCommission(assignment.id)}
                          className="flex items-center gap-1 hover:text-primary"
                        >
                          <DollarSign className="h-4 w-4" />
                          {assignment.commission_percentage}%
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Activo</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (window.confirm('¿Eliminar asignación de reseller?')) {
                            removeAssignment(assignment.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No hay resellers asignados. Crea uno para empezar.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
