import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSecretaries } from '@/hooks/useSecretaries';
import { useUserDeviceAccess } from '@/hooks/useUserDeviceAccess';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function Secretaries() {
  const [viewMikrotik, setViewMikrotik] = useState<string>('');
  const [dialogMikrotik, setDialogMikrotik] = useState<string>('');
  const [secretaryEmail, setSecretaryEmail] = useState('');
  const [secretaryPassword, setSecretaryPassword] = useState('');
  const [secretaryFullName, setSecretaryFullName] = useState('');
  const [canManagePppoe, setCanManagePppoe] = useState(true);
  const [canManageQueues, setCanManageQueues] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<any>(null);

  // Permisos PPPoE
  const [canCreatePppoe, setCanCreatePppoe] = useState(true);
  const [canEditPppoe, setCanEditPppoe] = useState(true);
  const [canDeletePppoe, setCanDeletePppoe] = useState(true);
  const [canDisconnectPppoe, setCanDisconnectPppoe] = useState(true);
  const [canTogglePppoe, setCanTogglePppoe] = useState(true);

  // Permisos Queues
  const [canCreateQueues, setCanCreateQueues] = useState(true);
  const [canEditQueues, setCanEditQueues] = useState(true);
  const [canDeleteQueues, setCanDeleteQueues] = useState(true);
  const [canToggleQueues, setCanToggleQueues] = useState(true);
  const [canSuspendQueues, setCanSuspendQueues] = useState(true);
  const [canReactivateQueues, setCanReactivateQueues] = useState(true);

  const { devices } = useUserDeviceAccess();
  const { assignments, isLoading, assignSecretary, removeSecretary, updateSecretary } = useSecretaries(viewMikrotik);

  const handleAssignSecretary = async () => {
    if (!secretaryEmail || !secretaryPassword || !dialogMikrotik) {
      toast.error('Completa todos los campos requeridos');
      return;
    }

    try {
      let userId: string;
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', secretaryEmail)
        .maybeSingle();

      if (existingProfile) {
        userId = existingProfile.user_id;
      } else {
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: secretaryEmail,
          password: secretaryPassword,
          options: {
            data: {
              full_name: secretaryFullName || secretaryEmail,
            },
          },
        });

        if (signUpError) {
          toast.error('Error al crear usuario: ' + signUpError.message);
          return;
        }

        if (!authData.user) {
          toast.error('No se pudo crear el usuario');
          return;
        }

        userId = authData.user.id;

        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            user_id: userId,
            email: secretaryEmail,
            full_name: secretaryFullName || secretaryEmail,
          });

        if (profileError) {
          console.error('Error al crear perfil:', profileError);
        }
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          role: 'secretary',
        });

      if (roleError) {
        toast.error('Error al asignar rol');
        return;
      }

      assignSecretary({
        secretaryId: userId,
        mikrotikId: dialogMikrotik,
        canManagePppoe,
        canManageQueues,
        canCreatePppoe,
        canEditPppoe,
        canDeletePppoe,
        canDisconnectPppoe,
        canTogglePppoe,
        canCreateQueues,
        canEditQueues,
        canDeleteQueues,
        canToggleQueues,
        canSuspendQueues,
        canReactivateQueues,
      });

      setIsDialogOpen(false);
      setDialogMikrotik('');
      setSecretaryEmail('');
      setSecretaryPassword('');
      setSecretaryFullName('');
      resetPermissions();
      toast.success('Secretaria asignada exitosamente');
    } catch (error: any) {
      toast.error('Error: ' + error.message);
    }
  };

  const resetPermissions = () => {
    setCanManagePppoe(true);
    setCanManageQueues(true);
    setCanCreatePppoe(true);
    setCanEditPppoe(true);
    setCanDeletePppoe(true);
    setCanDisconnectPppoe(true);
    setCanTogglePppoe(true);
    setCanCreateQueues(true);
    setCanEditQueues(true);
    setCanDeleteQueues(true);
    setCanToggleQueues(true);
    setCanSuspendQueues(true);
    setCanReactivateQueues(true);
  };

  const handleUpdatePermissions = (assignment: any, updates: any) => {
    updateSecretary({
      assignmentId: assignment.id,
      ...updates,
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Gestión de Secretarias</h1>
        <p className="text-muted-foreground">
          Asigna secretarias con permisos personalizados para administrar PPPoE y Queues
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Secretarias Asignadas</CardTitle>
                <CardDescription>Administra los permisos de tus secretarias</CardDescription>
              </div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Asignar Secretaria
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Asignar Nueva Secretaria</DialogTitle>
                    <DialogDescription>
                      Configura los permisos específicos para la secretaria
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div>
                      <Label>Dispositivo MikroTik</Label>
                      <Select value={dialogMikrotik} onValueChange={setDialogMikrotik}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un dispositivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {devices?.map((device) => (
                            <SelectItem key={device.id} value={device.id}>
                              {device.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Nombre Completo</Label>
                      <Input
                        type="text"
                        value={secretaryFullName}
                        onChange={(e) => setSecretaryFullName(e.target.value)}
                        placeholder="Nombre de la secretaria"
                      />
                    </div>

                    <div>
                      <Label>Email de la Secretaria</Label>
                      <Input
                        type="email"
                        value={secretaryEmail}
                        onChange={(e) => setSecretaryEmail(e.target.value)}
                        placeholder="secretaria@ejemplo.com"
                        required
                      />
                    </div>

                    <div>
                      <Label>Contraseña</Label>
                      <Input
                        type="password"
                        value={secretaryPassword}
                        onChange={(e) => setSecretaryPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={6}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Mínimo 6 caracteres
                      </p>
                    </div>

                    <Accordion type="multiple" className="w-full">
                      <AccordionItem value="pppoe">
                        <AccordionTrigger>
                          <div className="flex items-center justify-between w-full pr-4">
                            <span>Permisos PPPoE</span>
                            <Switch
                              checked={canManagePppoe}
                              onCheckedChange={setCanManagePppoe}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pl-4">
                            <div className="flex items-center justify-between">
                              <Label>Crear usuarios PPPoE</Label>
                              <Switch checked={canCreatePppoe} onCheckedChange={setCanCreatePppoe} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Editar usuarios PPPoE</Label>
                              <Switch checked={canEditPppoe} onCheckedChange={setCanEditPppoe} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Eliminar usuarios PPPoE</Label>
                              <Switch checked={canDeletePppoe} onCheckedChange={setCanDeletePppoe} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Desconectar sesiones PPPoE</Label>
                              <Switch checked={canDisconnectPppoe} onCheckedChange={setCanDisconnectPppoe} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Activar/Desactivar usuarios</Label>
                              <Switch checked={canTogglePppoe} onCheckedChange={setCanTogglePppoe} />
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="queues">
                        <AccordionTrigger>
                          <div className="flex items-center justify-between w-full pr-4">
                            <span>Permisos Queues</span>
                            <Switch
                              checked={canManageQueues}
                              onCheckedChange={setCanManageQueues}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pl-4">
                            <div className="flex items-center justify-between">
                              <Label>Crear colas</Label>
                              <Switch checked={canCreateQueues} onCheckedChange={setCanCreateQueues} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Editar colas</Label>
                              <Switch checked={canEditQueues} onCheckedChange={setCanEditQueues} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Eliminar colas</Label>
                              <Switch checked={canDeleteQueues} onCheckedChange={setCanDeleteQueues} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Activar/Desactivar colas</Label>
                              <Switch checked={canToggleQueues} onCheckedChange={setCanToggleQueues} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Suspender servicios (Address List)</Label>
                              <Switch checked={canSuspendQueues} onCheckedChange={setCanSuspendQueues} />
                            </div>
                            <div className="flex items-center justify-between">
                              <Label>Reactivar servicios</Label>
                              <Switch checked={canReactivateQueues} onCheckedChange={setCanReactivateQueues} />
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    <Button onClick={handleAssignSecretary} className="w-full">
                      Asignar Secretaria
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            
            <div>
              <Label>Seleccionar Dispositivo</Label>
              <Select value={viewMikrotik} onValueChange={setViewMikrotik}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Selecciona un dispositivo" />
                </SelectTrigger>
                <SelectContent>
                  {devices?.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!viewMikrotik ? (
            <div className="text-center py-8 text-muted-foreground">
              Selecciona un dispositivo para ver las secretarias asignadas
            </div>
          ) : isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : assignments && assignments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID Secretaria</TableHead>
                  <TableHead>Acceso PPPoE</TableHead>
                  <TableHead>Acceso Queues</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-mono text-xs">{assignment.secretary_id}</TableCell>
                    <TableCell>
                      <Switch
                        checked={assignment.can_manage_pppoe}
                        onCheckedChange={(checked) => {
                          handleUpdatePermissions(assignment, { can_manage_pppoe: checked });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={assignment.can_manage_queues}
                        onCheckedChange={(checked) => {
                          handleUpdatePermissions(assignment, { can_manage_queues: checked });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {new Date(assignment.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingAssignment(assignment)}
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Permisos Detallados</DialogTitle>
                              <DialogDescription>
                                Configura permisos específicos para esta secretaria
                              </DialogDescription>
                            </DialogHeader>
                            {editingAssignment && (
                              <div className="space-y-4">
                                <div className="space-y-3">
                                  <h3 className="font-semibold">Permisos PPPoE</h3>
                                  <div className="flex items-center justify-between">
                                    <Label>Crear usuarios</Label>
                                    <Switch
                                      checked={editingAssignment.can_create_pppoe ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_create_pppoe: checked });
                                        setEditingAssignment({...editingAssignment, can_create_pppoe: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Editar usuarios</Label>
                                    <Switch
                                      checked={editingAssignment.can_edit_pppoe ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_edit_pppoe: checked });
                                        setEditingAssignment({...editingAssignment, can_edit_pppoe: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Eliminar usuarios</Label>
                                    <Switch
                                      checked={editingAssignment.can_delete_pppoe ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_delete_pppoe: checked });
                                        setEditingAssignment({...editingAssignment, can_delete_pppoe: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Desconectar sesiones</Label>
                                    <Switch
                                      checked={editingAssignment.can_disconnect_pppoe ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_disconnect_pppoe: checked });
                                        setEditingAssignment({...editingAssignment, can_disconnect_pppoe: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Activar/Desactivar</Label>
                                    <Switch
                                      checked={editingAssignment.can_toggle_pppoe ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_toggle_pppoe: checked });
                                        setEditingAssignment({...editingAssignment, can_toggle_pppoe: checked});
                                      }}
                                    />
                                  </div>
                                </div>

                                <div className="space-y-3">
                                  <h3 className="font-semibold">Permisos Queues</h3>
                                  <div className="flex items-center justify-between">
                                    <Label>Crear colas</Label>
                                    <Switch
                                      checked={editingAssignment.can_create_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_create_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_create_queues: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Editar colas</Label>
                                    <Switch
                                      checked={editingAssignment.can_edit_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_edit_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_edit_queues: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Eliminar colas</Label>
                                    <Switch
                                      checked={editingAssignment.can_delete_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_delete_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_delete_queues: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Activar/Desactivar</Label>
                                    <Switch
                                      checked={editingAssignment.can_toggle_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_toggle_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_toggle_queues: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Suspender servicios</Label>
                                    <Switch
                                      checked={editingAssignment.can_suspend_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_suspend_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_suspend_queues: checked});
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <Label>Reactivar servicios</Label>
                                    <Switch
                                      checked={editingAssignment.can_reactivate_queues ?? true}
                                      onCheckedChange={(checked) => {
                                        handleUpdatePermissions(editingAssignment, { can_reactivate_queues: checked });
                                        setEditingAssignment({...editingAssignment, can_reactivate_queues: checked});
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSecretary(assignment.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No hay secretarias asignadas a este dispositivo
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
