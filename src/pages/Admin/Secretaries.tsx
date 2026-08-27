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

// All permission groups with their sub-permissions
const PERM_GROUPS = [
  {
    id: 'pppoe', label: 'Permisos PPPoE', masterKey: 'can_manage_pppoe',
    subs: [
      ['can_create_pppoe', 'Crear usuarios PPPoE'],
      ['can_edit_pppoe', 'Editar usuarios PPPoE'],
      ['can_delete_pppoe', 'Eliminar usuarios PPPoE'],
      ['can_disconnect_pppoe', 'Desconectar sesiones PPPoE'],
      ['can_toggle_pppoe', 'Activar/Desactivar usuarios'],
    ],
  },
  {
    id: 'queues', label: 'Permisos Queues', masterKey: 'can_manage_queues',
    subs: [
      ['can_create_queues', 'Crear colas'],
      ['can_edit_queues', 'Editar colas'],
      ['can_delete_queues', 'Eliminar colas'],
      ['can_toggle_queues', 'Activar/Desactivar colas'],
      ['can_suspend_queues', 'Suspender servicios (Address List)'],
      ['can_reactivate_queues', 'Reactivar servicios'],
    ],
  },
  {
    id: 'hotspot', label: 'Permisos Hotspot', masterKey: 'can_manage_hotspot',
    subs: [
      ['can_create_hotspot_users', 'Crear usuarios Hotspot'],
      ['can_edit_hotspot_users', 'Editar usuarios Hotspot'],
      ['can_delete_hotspot_users', 'Eliminar usuarios Hotspot'],
      ['can_manage_vouchers', 'Gestionar Vouchers'],
      ['can_sell_vouchers', 'Vender Vouchers'],
      ['can_print_vouchers', 'Imprimir Vouchers'],
      ['can_view_hotspot_accounting', 'Ver Contabilidad'],
      ['can_view_hotspot_reports', 'Ver Reportes'],
    ],
  },
  {
    id: 'clients', label: 'Permisos Clientes', masterKey: 'can_manage_clients',
    subs: [
      ['can_create_clients', 'Registrar clientes'],
      ['can_edit_clients', 'Editar clientes'],
      ['can_delete_clients', 'Eliminar clientes'],
    ],
  },
  {
    id: 'payments', label: 'Permisos Pagos', masterKey: 'can_manage_payments',
    subs: [
      ['can_record_payments', 'Registrar pagos/abonos'],
      ['can_view_payment_history', 'Ver historial de pagos'],
      ['can_reactivate_services', 'Reactivar servicios'],
    ],
  },
  {
    id: 'billing', label: 'Permisos Facturación', masterKey: 'can_manage_billing',
    subs: [
      ['can_create_invoices', 'Crear facturas'],
      ['can_edit_invoices', 'Editar facturas'],
      ['can_delete_invoices', 'Eliminar facturas'],
      ['can_send_invoices', 'Enviar facturas'],
    ],
  },
  {
    id: 'reports', label: 'Permisos Reportes', masterKey: 'can_manage_reports',
    subs: [
      ['can_view_reports_dashboard', 'Ver dashboard de reportes'],
      ['can_export_reports', 'Exportar reportes'],
    ],
  },
  {
    id: 'address_list', label: 'Permisos Address List', masterKey: 'can_manage_address_list',
    subs: [
      ['can_create_address_list', 'Agregar entradas'],
      ['can_delete_address_list', 'Eliminar entradas'],
    ],
  },
  {
    id: 'backup', label: 'Permisos Backup', masterKey: 'can_manage_backup',
    subs: [
      ['can_create_backup', 'Crear backup'],
      ['can_restore_backup', 'Restaurar backup'],
    ],
  },
  {
    id: 'vps', label: 'Permisos VPS', masterKey: 'can_manage_vps_services',
    subs: [
      ['can_view_vps', 'Ver servicios VPS'],
      ['can_manage_vps_docker', 'Gestionar Docker/Servicios'],
    ],
  },
];

// Get all sub-permission keys
const ALL_SUB_KEYS = PERM_GROUPS.flatMap(g => g.subs.map(s => s[0]));
const ALL_MASTER_KEYS = PERM_GROUPS.map(g => g.masterKey);

function getDefaultPerms(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PERM_GROUPS.forEach(g => {
    perms[g.masterKey] = true;
    g.subs.forEach(([key]) => { perms[key] = true; });
  });
  return perms;
}

export default function Secretaries() {
  const [viewMikrotik, setViewMikrotik] = useState<string>('');
  const [dialogMikrotik, setDialogMikrotik] = useState<string>('');
  const [secretaryEmail, setSecretaryEmail] = useState('');
  const [secretaryPassword, setSecretaryPassword] = useState('');
  const [secretaryFullName, setSecretaryFullName] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<any>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>(getDefaultPerms());

  const { user } = useAuth();
  const { data: devices } = useQuery({
    queryKey: ['admin-assigned-devices', user?.id],
    queryFn: () => devicesApi.list(),
    enabled: !!user,
  });
  const { assignments, isLoading, assignSecretary, removeSecretary, updateSecretary } = useSecretaries(viewMikrotik);

  const setPerm = (key: string, val: boolean) => setPerms(prev => ({ ...prev, [key]: val }));

  const handleAssignSecretary = async () => {
    if (!secretaryEmail || !secretaryPassword || !dialogMikrotik) {
      toast.error('Completa todos los campos requeridos'); return;
    }
    if (secretaryPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres'); return;
    }
    try {
      const response = await usersApi.createUser({
        email: secretaryEmail, password: secretaryPassword,
        full_name: secretaryFullName || secretaryEmail, role: 'secretary',
      });
      const createdUser = (response as any)?.user || (response as any)?.data || response;
      const userId = createdUser?.id;
      if (!userId) throw new Error('No se pudo obtener el ID del usuario creado');

      assignSecretary({ secretaryId: userId, mikrotikId: dialogMikrotik, ...perms });
      setIsDialogOpen(false);
      setDialogMikrotik(''); setSecretaryEmail(''); setSecretaryPassword(''); setSecretaryFullName('');
      setPerms(getDefaultPerms());
      toast.success('Secretaria asignada exitosamente');
    } catch (error: any) {
      toast.error('Error: ' + error.message);
    }
  };

  const handleUpdatePermissions = (assignment: any, updates: any) => {
    updateSecretary({ assignmentId: assignment.id, ...updates });
  };

  const renderPermAccordion = (value: Record<string, boolean>, onChange: (key: string, val: boolean) => void) => (
    <Accordion type="multiple" className="w-full">
      {PERM_GROUPS.map(group => (
        <AccordionItem key={group.id} value={group.id}>
          <AccordionTrigger>
            <div className="flex items-center justify-between w-full pr-4">
              <span>{group.label}</span>
              <Switch
                checked={value[group.masterKey] ?? true}
                onCheckedChange={(v) => onChange(group.masterKey, v)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pl-4">
              {group.subs.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <Label>{label}</Label>
                  <Switch checked={value[key] ?? true} onCheckedChange={(v) => onChange(key, v)} />
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );

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

                        {renderPermAccordion(perms, setPerm)}

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
                    <TableHead>Secretaria</TableHead>
                    <TableHead>PPPoE</TableHead>
                    <TableHead>Queues</TableHead>
                    <TableHead>Hotspot</TableHead>
                    <TableHead>Clientes</TableHead>
                    <TableHead>Pagos</TableHead>
                    <TableHead>Fact.</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {assignments.map((assignment: any) => (
                      <TableRow key={assignment.id}>
                        <TableCell><div><p className="font-medium text-sm">{assignment.secretary_name || assignment.full_name || 'Sin nombre'}</p><p className="text-xs text-muted-foreground">{assignment.secretary_email || assignment.email || assignment.secretary_id}</p></div></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_pppoe !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_pppoe: checked })} /></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_queues !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_queues: checked })} /></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_hotspot !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_hotspot: checked })} /></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_clients !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_clients: checked })} /></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_payments !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_payments: checked })} /></TableCell>
                        <TableCell><Switch checked={assignment.can_manage_billing !== false} onCheckedChange={(checked) => handleUpdatePermissions(assignment, { can_manage_billing: checked })} /></TableCell>
                        <TableCell className="text-xs">{new Date(assignment.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Dialog>
                              <DialogTrigger asChild><Button variant="ghost" size="sm" onClick={() => setEditingAssignment({...assignment})}><Settings className="h-4 w-4" /></Button></DialogTrigger>
                              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                <DialogHeader><DialogTitle>Permisos Detallados</DialogTitle><DialogDescription>Configura permisos específicos para esta secretaria</DialogDescription></DialogHeader>
                                {editingAssignment && (
                                  <div className="space-y-4">
                                    {PERM_GROUPS.map(group => (
                                      <div key={group.id} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                          <h3 className="font-semibold">{group.label}</h3>
                                          <Switch
                                            checked={editingAssignment[group.masterKey] !== false}
                                            onCheckedChange={(checked) => {
                                              handleUpdatePermissions(editingAssignment, { [group.masterKey]: checked });
                                              setEditingAssignment({ ...editingAssignment, [group.masterKey]: checked });
                                            }}
                                          />
                                        </div>
                                        {group.subs.map(([key, label]) => (
                                          <div key={key} className="flex items-center justify-between pl-4">
                                            <Label className="text-sm">{label}</Label>
                                            <Switch
                                              checked={editingAssignment[key] ?? true}
                                              onCheckedChange={(checked) => {
                                                handleUpdatePermissions(editingAssignment, { [key]: checked });
                                                setEditingAssignment({ ...editingAssignment, [key]: checked });
                                              }}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </DialogContent>
                            </Dialog>
                            <Button variant="ghost" size="sm" onClick={() => removeSecretary(assignment.id)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
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
