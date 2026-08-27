import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantsApi } from '@/lib/api-client';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Building2, Plus, Trash2, Copy, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

const emptyForm = {
  name: '',
  slug: '',
  logo_url: '',
  admin_email: '',
  admin_password: '',
  admin_name: '',
};

export default function Tenants() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => tenantsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('ISP creado correctamente');
      setForm(emptyForm);
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message || 'Error al crear el ISP'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tenantsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('ISP actualizado');
    },
    onError: (e: any) => toast.error(e.message || 'Error al actualizar'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('ISP eliminado');
    },
    onError: (e: any) => toast.error(e.message || 'Error al eliminar'),
  });

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) {
      toast.error('El logo debe pesar menos de 500KB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setForm((f) => ({ ...f, logo_url: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const accessLink = (slug: string) => `${window.location.origin}/isp/${slug}`;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64 p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" />
              ISPs (Multi-empresa)
            </h1>
            <p className="text-sm text-muted-foreground">
              Cada ISP ve únicamente sus MikroTik y sus ONUs, con su propio logo y nombre.
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Nuevo ISP</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Crear ISP</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Nombre del ISP</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Redes del Valle" />
                </div>
                <div className="space-y-1">
                  <Label>Enlace personalizado (slug)</Label>
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="redes-del-valle" />
                  <p className="text-xs text-muted-foreground">Acceso: {window.location.origin}/isp/{form.slug || 'slug'}</p>
                </div>
                <div className="space-y-1">
                  <Label>Logo</Label>
                  <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      <Upload className="w-4 h-4 mr-1" />Subir logo
                    </Button>
                    {form.logo_url && <img src={form.logo_url} alt="Logo del ISP" className="h-10 rounded object-contain" />}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Email del administrador</Label>
                    <Input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Contraseña</Label>
                    <Input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={createMutation.isPending || !form.name}
                  onClick={() => createMutation.mutate(form)}
                >
                  Crear ISP
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </header>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando ISPs...</p>
        ) : tenants.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Todavía no hay ISPs creados. Los datos actuales siguen funcionando como hasta ahora.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tenants.map((t: any) => (
              <Card key={t.id}>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  {t.logo_url ? (
                    <img src={t.logo_url} alt={`Logo ${t.name}`} className="h-10 w-10 rounded object-contain bg-muted" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <CardDescription>/isp/{t.slug}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Usuarios: {t.users_count ?? 0}</span>
                    <span>MikroTiks: {t.devices_count ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Activo</Label>
                    <Switch
                      checked={t.is_active !== false}
                      onCheckedChange={(v) => updateMutation.mutate({ id: t.id, data: { is_active: v } })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => copyToClipboard(accessLink(t.slug))}>
                      <Copy className="w-3.5 h-3.5 mr-1" />Copiar enlace
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => removeMutation.mutate(t.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
