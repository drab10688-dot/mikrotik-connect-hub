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
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Secretaries() {
  const [viewMikrotik, setViewMikrotik] = useState<string>('');
  const [dialogMikrotik, setDialogMikrotik] = useState<string>('');
  const [secretaryEmail, setSecretaryEmail] = useState('');
  const [secretaryPassword, setSecretaryPassword] = useState('');
  const [secretaryFullName, setSecretaryFullName] = useState('');
  const [canManagePppoe, setCanManagePppoe] = useState(true);
  const [canManageQueues, setCanManageQueues] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { devices } = useUserDeviceAccess();
  const { assignments, isLoading, assignSecretary, removeSecretary, updateSecretary } = useSecretaries(viewMikrotik);

  const handleAssignSecretary = async () => {
    if (!secretaryEmail || !secretaryPassword || !dialogMikrotik) {
      toast.error('Completa todos los campos requeridos');
      return;
    }

    try {
      // Primero buscar si el usuario ya existe
      let userId: string;
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', secretaryEmail)
        .maybeSingle();

      if (existingProfile) {
        // Usuario ya existe
        userId = existingProfile.user_id;
      } else {
        // Crear nuevo usuario con Supabase Auth
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

        // Crear perfil
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

      // Asignar rol de secretaria
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

      // Asignar permisos
      assignSecretary({
        secretaryId: userId,
        mikrotikId: dialogMikrotik,
        canManagePppoe,
        canManageQueues,
      });

      setIsDialogOpen(false);
      setDialogMikrotik('');
      setSecretaryEmail('');
      setSecretaryPassword('');
      setSecretaryFullName('');
      setCanManagePppoe(true);
      setCanManageQueues(true);
      toast.success('Secretaria asignada exitosamente');
    } catch (error: any) {
      toast.error('Error: ' + error.message);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Gestión de Secretarias</h1>
        <p className="text-muted-foreground">
          Asigna secretarias con permisos limitados para administrar PPPoE y Queues
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
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Asignar Nueva Secretaria</DialogTitle>
                    <DialogDescription>
                      Asigna permisos a una secretaria para administrar dispositivos específicos
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

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="pppoe-permission">Gestión PPPoE</Label>
                        <Switch
                          id="pppoe-permission"
                          checked={canManagePppoe}
                          onCheckedChange={setCanManagePppoe}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="queues-permission">Gestión Queues</Label>
                        <Switch
                          id="queues-permission"
                          checked={canManageQueues}
                          onCheckedChange={setCanManageQueues}
                        />
                      </div>
                    </div>

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
                  <TableHead>PPPoE</TableHead>
                  <TableHead>Queues</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Acciones</TableHead>
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
                          updateSecretary({
                            assignmentId: assignment.id,
                            canManagePppoe: checked,
                            canManageQueues: assignment.can_manage_queues || false,
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={assignment.can_manage_queues}
                        onCheckedChange={(checked) => {
                          updateSecretary({
                            assignmentId: assignment.id,
                            canManagePppoe: assignment.can_manage_pppoe || false,
                            canManageQueues: checked,
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {new Date(assignment.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSecretary(assignment.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
