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
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { devicesApi, usersApi } from '@/lib/api-client';
import { Plus, Trash2, Settings } from 'lucide-react';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const MODULE_PERMISSIONS = [
  { key: 'can_manage_clients', label: 'Gestión de Clientes' },
  { key: 'can_manage_payments', label: 'Pagos y Abonos' },
  { key: 'can_manage_billing', label: 'Facturación' },
  { key: 'can_manage_reports', label: 'Reportes' },
  { key: 'can_manage_hotspot', label: 'Hotspot Monitor' },
  { key: 'can_manage_address_list', label: 'Address List' },
  { key: 'can_manage_backup', label: 'Backup/Restore' },
  { key: 'can_manage_vps_services', label: 'Servicios VPS' },
];

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

  const [canCreatePppoe, setCanCreatePppoe] = useState(true);
  const [canEditPppoe, setCanEditPppoe] = useState(true);
  const [canDeletePppoe, setCanDeletePppoe] = useState(true);
  const [canDisconnectPppoe, setCanDisconnectPppoe] = useState(true);
  const [canTogglePppoe, setCanTogglePppoe] = useState(true);
  const [canCreateQueues, setCanCreateQueues] = useState(true);
  const [canEditQueues, setCanEditQueues] = useState(true);
  const [canDeleteQueues, setCanDeleteQueues] = useState(true);
  const [canToggleQueues, setCanToggleQueues] = useState(true);
  const [canSuspendQueues, setCanSuspendQueues] = useState(true);
  const [canReactivateQueues, setCanReactivateQueues] = useState(true);

  // Hotspot sub-permissions
  const [canCreateHotspotUsers, setCanCreateHotspotUsers] = useState(true);
  const [canEditHotspotUsers, setCanEditHotspotUsers] = useState(true);
  const [canDeleteHotspotUsers, setCanDeleteHotspotUsers] = useState(true);
  const [canManageVouchers, setCanManageVouchers] = useState(true);
  const [canSellVouchers, setCanSellVouchers] = useState(true);
  const [canPrintVouchers, setCanPrintVouchers] = useState(true);
  const [canViewHotspotAccounting, setCanViewHotspotAccounting] = useState(true);
  const [canViewHotspotReports, setCanViewHotspotReports] = useState(true);

  // Module permissions
  const [modulePerms, setModulePerms] = useState<Record<string, boolean>>(
    Object.fromEntries(MODULE_PERMISSIONS.map(p => [p.key, true]))
  );

  const { user } = useAuth();
  
  const { data: devices } = useQuery({
    queryKey: ['admin-assigned-devices', user?.id],
    queryFn: () => devicesApi.list(),
    enabled: !!user,
  });
  
  const { assignments, isLoading, assignSecretary, removeSecretary, updateSecretary } = useSecretaries(viewMikrotik);

  const handleAssignSecretary = async () => {
    if (!secretaryEmail || !secretaryPassword || !dialogMikrotik) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    if (secretaryPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    try {
      const response = await usersApi.createUser({
        email: secretaryEmail,
        password: secretaryPassword,
        full_name: secretaryFullName || secretaryEmail,
        role: 'secretary',
      });

      const createdUser = (response as any)?.user || (response as any)?.data || response;
      const userId = createdUser?.id;
      if (!userId) throw new Error('No se pudo obtener el ID del usuario creado');

      assignSecretary({
        secretaryId: userId,
        mikrotikId: dialogMikrotik,
        canManagePppoe, canManageQueues,
        canCreatePppoe, canEditPppoe, canDeletePppoe, canDisconnectPppoe, canTogglePppoe,
        canCreateQueues, canEditQueues, canDeleteQueues, canToggleQueues, canSuspendQueues, canReactivateQueues,
        canCreateHotspotUsers, canEditHotspotUsers, canDeleteHotspotUsers,
        canManageVouchers, canSellVouchers, canPrintVouchers,
        canViewHotspotAccounting, canViewHotspotReports,
        ...modulePerms,
      });

      setIsDialogOpen(false);
      setDialogMikrotik(''); setSecretaryEmail(''); setSecretaryPassword(''); setSecretaryFullName('');
      resetPermissions();
      toast.success('Secretaria asignada exitosamente');
    } catch (error: any) {
      toast.error('Error: ' + error.message);
    }
  };

  const resetPermissions = () => {
    setCanManagePppoe(true); setCanManageQueues(true);
    setCanCreatePppoe(true); setCanEditPppoe(true); setCanDeletePppoe(true); setCanDisconnectPppoe(true); setCanTogglePppoe(true);
    setCanCreateQueues(true); setCanEditQueues(true); setCanDeleteQueues(true); setCanToggleQueues(true); setCanSuspendQueues(true); setCanReactivateQueues(true);
    setCanCreateHotspotUsers(true); setCanEditHotspotUsers(true); setCanDeleteHotspotUsers(true);
    setCanManageVouchers(true); setCanSellVouchers(true); setCanPrintVouchers(true);
    setCanViewHotspotAccounting(true); setCanViewHotspotReports(true);
    setModulePerms(Object.fromEntries(MODULE_PERMISSIONS.map(p => [p.key, true])));
  };

  const handleUpdatePermissions = (assignment: any, updates: any) => {
    updateSecretary({ assignmentId: assignment.id, ...updates });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Asistentes</h1>
          <p className="text-muted-foreground">Asigna asistentes con permisos personalizados para administrar módulos del sistema</p>
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
                  <Button><Plus className="h-4 w-4 mr-2" />Asignar Secretaria</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Asignar Nueva Secretaria</DialogTitle>
                    <DialogDescription>Configura los permisos específicos para la secretaria</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Dispositivo MikroTik</Label>
                      <Select value={dialogMikrotik} onValueChange={setDialogMikrotik}>
                        <SelectTrigger><SelectValue placeholder="Selecciona un dispositivo" /></SelectTrigger>
                        <SelectContent>{devices?.map((device: any) => (<SelectItem key={device.id} value={device.id}>{device.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Nombre Completo</Label><Input type="text" value={secretaryFullName} onChange={(e) => setSecretaryFullName(e.target.value)} placeholder="Nombre de la secretaria" /></div>
                    <div><Label>Email de la Secretaria</Label><Input type="email" value={secretaryEmail} onChange={(e) => setSecretaryEmail(e.target.value)} placeholder="secretaria@ejemplo.com" required /></div>
                    <div><Label>Contraseña</Label><Input type="password" value={secretaryPassword} onChange={(e) => setSecretaryPassword(e.target.value)} placeholder="••••••••" required minLength={6} /><p className="text-xs text-muted-foreground mt-1">Mínimo 6 caracteres</p></div>
                    <Accordion type="multiple" className="w-full">
                      <AccordionItem value="modules">
                        <AccordionTrigger><span className="font-semibold">Módulos del Sistema</span></AccordionTrigger>
                        <AccordionContent><div className="space-y-3 pl-4">
                          {MODULE_PERMISSIONS.map(p => (
                            <div key={p.key} className="flex items-center justify-between">
                              <Label>{p.label}</Label>
                              <Switch checked={modulePerms[p.key]} onCheckedChange={(v) => setModulePerms(prev => ({...prev, [p.key]: v}))} />
                            </div>
                          ))}
                        </div></AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="pppoe">
                        <AccordionTrigger><div className="flex items-center justify-between w-full pr-4"><span>Permisos PPPoE</span><Switch checked={canManagePppoe} onCheckedChange={setCanManagePppoe} onClick={(e) => e.stopPropagation()} /></div></AccordionTrigger>
                        <AccordionContent><div className="space-y-3 pl-4">
                          <div className="flex items-center justify-between"><Label>Crear usuarios PPPoE</Label><Switch checked={canCreatePppoe} onCheckedChange={setCanCreatePppoe} /></div>
                          <div className="flex items-center justify-between"><Label>Editar usuarios PPPoE</Label><Switch checked={canEditPppoe} onCheckedChange={setCanEditPppoe} /></div>
                          <div className="flex items-center justify-between"><Label>Eliminar usuarios PPPoE</Label><Switch checked={canDeletePppoe} onCheckedChange={setCanDeletePppoe} /></div>
                          <div className="flex items-center justify-between"><Label>Desconectar sesiones PPPoE</Label><Switch checked={canDisconnectPppoe} onCheckedChange={setCanDisconnectPppoe} /></div>
                          <div className="flex items-center justify-between"><Label>Activar/Desactivar usuarios</Label><Switch checked={canTogglePppoe} onCheckedChange={setCanTogglePppoe} /></div>
                        </div></AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="queues">
                        <AccordionTrigger><div className="flex items-center justify-between w-full pr-4"><span>Permisos Queues</span><Switch checked={canManageQueues} onCheckedChange={setCanManageQueues} onClick={(e) => e.stopPropagation()} /></div></AccordionTrigger>
                        <AccordionContent><div className="space-y-3 pl-4">
                          <div className="flex items-center justify-between"><Label>Crear colas</Label><Switch checked={canCreateQueues} onCheckedChange={setCanCreateQueues} /></div>
                          <div className="flex items-center justify-between"><Label>Editar colas</Label><Switch checked={canEditQueues} onCheckedChange={setCanEditQueues} /></div>
                          <div className="flex items-center justify-between"><Label>Eliminar colas</Label><Switch checked={canDeleteQueues} onCheckedChange={setCanDeleteQueues} /></div>
                          <div className="flex items-center justify-between"><Label>Activar/Desactivar colas</Label><Switch checked={canToggleQueues} onCheckedChange={setCanToggleQueues} /></div>
                          <div className="flex items-center justify-between"><Label>Suspender servicios (Address List)</Label><Switch checked={canSuspendQueues} onCheckedChange={setCanSuspendQueues} /></div>
                          <div className="flex items-center justify-between"><Label>Reactivar servicios</Label><Switch checked={canReactivateQueues} onCheckedChange={setCanReactivateQueues} /></div>
                        </div></AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Button onClick={handleAssignSecretary} className="w-full">Asignar Secretaria</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div>
              <Label>Seleccionar Dispositivo</Label>
              <Select value={viewMikrotik} onValueChange={setViewMikrotik}>
                <SelectTrigger className="w-full max-w-md"><SelectValue placeholder="Selecciona un dispositivo" /></SelectTrigger>
                <SelectContent>{devices?.map((device: any) => (<SelectItem key={device.id} value={device.id}>{device.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!viewMikrotik ? (
            <div className="text-center py-8 text-muted-foreground">Selecciona un dispositivo para ver las secretarias asignadas</div>
          ) : isLoading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div></div>
          ) : assignments && assignments.length > 0 ? (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Secretaria</TableHead><TableHead>PPPoE</TableHead><TableHead>Queues</TableHead><TableHead>Módulos</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {assignments.map((assignment: any) => {
                  const activeModules = MODULE_PERMISSIONS.filter(p => assignment[p.key] !== false).length;
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell><div><p className="font-medium">{assignment.secretary_name || assignment.full_name || 'Sin nombre'}</p><p className="text-sm text-muted-foreground">{assignment.secretary_email || assignment.email || assignment.secretary_id}</p></div></TableCell>
                      <TableCell><Switch checked={assignment.can_manage_pppoe} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_pppoe: checked })} /></TableCell>
                      <TableCell><Switch checked={assignment.can_manage_queues} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_queues: checked })} /></TableCell>
                      <TableCell><span className="text-sm text-muted-foreground">{activeModules}/{MODULE_PERMISSIONS.length}</span></TableCell>
                      <TableCell>{new Date(assignment.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Dialog>
                            <DialogTrigger asChild><Button variant="ghost" size="sm" onClick={() => setEditingAssignment(assignment)}><Settings className="h-4 w-4" /></Button></DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader><DialogTitle>Permisos Detallados</DialogTitle><DialogDescription>Configura permisos específicos para esta secretaria</DialogDescription></DialogHeader>
                              {editingAssignment && (
                                <div className="space-y-4">
                                  <div className="space-y-3">
                                    <h3 className="font-semibold">Módulos del Sistema</h3>
                                    {MODULE_PERMISSIONS.map(p => (
                                      <div key={p.key} className="flex items-center justify-between">
                                        <Label>{p.label}</Label>
                                        <Switch checked={editingAssignment[p.key] ?? true} onCheckedChange={(checked) => { handleUpdatePermissions(editingAssignment, { [p.key]: checked }); setEditingAssignment({...editingAssignment, [p.key]: checked}); }} />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="space-y-3">
                                    <h3 className="font-semibold">Permisos PPPoE</h3>
                                    {[['can_create_pppoe','Crear usuarios'],['can_edit_pppoe','Editar usuarios'],['can_delete_pppoe','Eliminar usuarios'],['can_disconnect_pppoe','Desconectar sesiones'],['can_toggle_pppoe','Activar/Desactivar']].map(([key, label]) => (
                                      <div key={key} className="flex items-center justify-between"><Label>{label}</Label><Switch checked={editingAssignment[key] ?? true} onCheckedChange={(checked) => { handleUpdatePermissions(editingAssignment, { [key]: checked }); setEditingAssignment({...editingAssignment, [key]: checked}); }} /></div>
                                    ))}
                                  </div>
                                  <div className="space-y-3">
                                    <h3 className="font-semibold">Permisos Queues</h3>
                                    {[['can_create_queues','Crear colas'],['can_edit_queues','Editar colas'],['can_delete_queues','Eliminar colas'],['can_toggle_queues','Activar/Desactivar'],['can_suspend_queues','Suspender servicios'],['can_reactivate_queues','Reactivar servicios']].map(([key, label]) => (
                                      <div key={key} className="flex items-center justify-between"><Label>{label}</Label><Switch checked={editingAssignment[key] ?? true} onCheckedChange={(checked) => { handleUpdatePermissions(editingAssignment, { [key]: checked }); setEditingAssignment({...editingAssignment, [key]: checked}); }} /></div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </DialogContent>
                          </Dialog>
                          <Button variant="ghost" size="sm" onClick={() => removeSecretary(assignment.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No hay secretarias asignadas a este dispositivo</div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
    </div>
  );
}
