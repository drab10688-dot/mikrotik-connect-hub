import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, Pencil, Users, Server, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { companiesApi } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Company {
  id: string;
  name: string;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  plan: string | null;
  max_devices: number;
  max_clients: number;
  is_active: boolean;
  users_count?: number;
  devices_count?: number;
  clients_count?: number;
}

const emptyForm = {
  name: '', tax_id: '', contact_email: '', contact_phone: '', address: '',
  plan: 'standard', max_devices: 0, max_clients: 0,
  admin_email: '', admin_password: '', admin_full_name: '',
};

export default function Companies() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['companies'] });

  const createMutation = useMutation({
    mutationFn: (data: any) => companiesApi.create(data),
    onSuccess: () => { toast.success('Empresa creada'); setOpen(false); setForm({ ...emptyForm }); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Error al crear la empresa'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => companiesApi.update(id, data),
    onSuccess: () => { toast.success('Empresa actualizada'); setOpen(false); setEditing(null); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Error al actualizar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.delete(id),
    onSuccess: () => { toast.success('Empresa eliminada'); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Error al eliminar'),
  });

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };

  const openEdit = (company: Company) => {
    setEditing(company);
    setForm({
      ...emptyForm,
      name: company.name || '',
      tax_id: company.tax_id || '',
      contact_email: company.contact_email || '',
      contact_phone: company.contact_phone || '',
      address: company.address || '',
      plan: company.plan || 'standard',
      max_devices: company.max_devices || 0,
      max_clients: company.max_clients || 0,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return; }
    const payload: any = {
      name: form.name,
      tax_id: form.tax_id || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      address: form.address || null,
      plan: form.plan,
      max_devices: Number(form.max_devices) || 0,
      max_clients: Number(form.max_clients) || 0,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      if (form.admin_email && form.admin_password) {
        payload.admin_email = form.admin_email;
        payload.admin_password = form.admin_password;
        payload.admin_full_name = form.admin_full_name || form.name;
      }
      createMutation.mutate(payload);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-6 space-y-6 overflow-x-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> Empresas
            </h1>
            <p className="text-sm text-muted-foreground">
              Cada empresa aísla sus dispositivos, clientes, facturación y equipos.
            </p>
          </div>
          {isSuperAdmin && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Nueva empresa
            </Button>
          )}
        </header>

        {isLoading ? (
          <p className="text-muted-foreground">Cargando empresas...</p>
        ) : companies.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Aún no hay empresas registradas.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {companies.map((company: Company) => (
              <Card key={company.id} className="border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{company.name}</CardTitle>
                    <Badge variant={company.is_active ? 'default' : 'secondary'}>
                      {company.is_active ? 'Activa' : 'Suspendida'}
                    </Badge>
                  </div>
                  {company.tax_id && (
                    <p className="text-xs text-muted-foreground">NIT: {company.tax_id}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <Server className="h-4 w-4 mx-auto text-muted-foreground" />
                      <p className="text-sm font-semibold">{company.devices_count ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Equipos</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <UserRound className="h-4 w-4 mx-auto text-muted-foreground" />
                      <p className="text-sm font-semibold">{company.clients_count ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Clientes</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <Users className="h-4 w-4 mx-auto text-muted-foreground" />
                      <p className="text-sm font-semibold">{company.users_count ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Usuarios</p>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Plan: <span className="text-foreground">{company.plan || 'standard'}</span></p>
                    <p>
                      Límites: {company.max_devices > 0 ? `${company.max_devices} equipos` : 'equipos ilimitados'} ·{' '}
                      {company.max_clients > 0 ? `${company.max_clients} clientes` : 'clientes ilimitados'}
                    </p>
                    {company.contact_email && <p>{company.contact_email}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(company)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                    </Button>
                    {isSuperAdmin && (
                      <>
                        <div className="flex items-center gap-2 ml-auto">
                          <Switch
                            checked={company.is_active}
                            onCheckedChange={(checked) =>
                              updateMutation.mutate({ id: company.id, data: { is_active: checked } })
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`¿Eliminar la empresa "${company.name}"?`)) deleteMutation.mutate(company.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar empresa' : 'Nueva empresa'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Actualiza los datos de la empresa.'
                  : 'Crea la empresa y, si quieres, su usuario administrador.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>NIT / ID fiscal</Label>
                  <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Email de contacto</Label>
                <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>

              {isSuperAdmin && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Plan</Label>
                    <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
                  </div>
                  <div>
                    <Label>Máx. equipos</Label>
                    <Input type="number" min={0} value={form.max_devices}
                      onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Máx. clientes</Label>
                    <Input type="number" min={0} value={form.max_clients}
                      onChange={(e) => setForm({ ...form, max_clients: Number(e.target.value) })} />
                  </div>
                </div>
              )}

              {!editing && isSuperAdmin && (
                <div className="rounded-lg border border-border/60 p-3 space-y-3">
                  <p className="text-sm font-medium">Administrador de la empresa (opcional)</p>
                  <div>
                    <Label>Nombre</Label>
                    <Input value={form.admin_full_name} onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
                    </div>
                    <div>
                      <Label>Contraseña</Label>
                      <Input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? 'Guardar cambios' : 'Crear empresa'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
