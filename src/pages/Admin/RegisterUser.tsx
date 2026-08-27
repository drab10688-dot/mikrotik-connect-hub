import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { devicesApi, usersApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { toast } from 'sonner';
import { UserPlus, ArrowLeft, Router } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function RegisterUser() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdmin, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'user' as 'super_admin' | 'admin' | 'user' | 'reseller' | 'secretary',
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['devices-for-assignment', user?.id],
    queryFn: () => devicesApi.list(),
    enabled: !loading && !!user && (isSuperAdmin || isAdmin),
  });

  const allowedRoles = useMemo(() => {
    return isSuperAdmin
      ? (['user', 'admin', 'super_admin', 'reseller', 'secretary'] as const)
      : (['user', 'reseller', 'secretary'] as const);
  }, [isSuperAdmin]);

  useEffect(() => {
    if (loading) return;
    if (!isSuperAdmin && !isAdmin) navigate('/dashboard', { replace: true });
  }, [loading, isSuperAdmin, isAdmin, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 p-4 md:p-8 md:ml-64">
          <div className="max-w-2xl mx-auto"><div className="text-center py-12 text-muted-foreground">Cargando...</div></div>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin && !isAdmin) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (!allowedRoles.includes(formData.role as any)) throw new Error('No tienes permisos para asignar ese rol');

      await usersApi.createUser({
        email: formData.email,
        password: formData.password,
        full_name: formData.fullName,
        role: formData.role,
        mikrotik_id: selectedDeviceId || null,
      });

      toast.success('Usuario registrado exitosamente');
      setFormData({ email: '', password: '', fullName: '', role: 'user' });
      setSelectedDeviceId('');
      setTimeout(() => navigate('/admin/users'), 1500);
    } catch (error: any) {
      toast.error(error.message || 'Error al registrar usuario');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/users')}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h1 className="text-3xl font-bold">Registrar Nuevo Usuario</h1>
              <p className="text-muted-foreground">Crea una nueva cuenta de usuario en el sistema</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Información del Usuario</CardTitle>
              <CardDescription>Complete todos los campos para registrar un nuevo usuario</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input id="fullName" placeholder="Juan Pérez" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Correo Electrónico</Label>
                  <Input id="email" type="email" placeholder="usuario@ejemplo.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input id="password" type="password" placeholder="••••••••" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required minLength={6} />
                  <p className="text-xs text-muted-foreground">Mínimo 6 caracteres</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select value={formData.role} onValueChange={(value: any) => setFormData({ ...formData, role: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuario</SelectItem>
                      <SelectItem value="reseller">Revendedor</SelectItem>
                      <SelectItem value="secretary">Secretaria</SelectItem>
                      {isSuperAdmin && (
                        <>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="super_admin">Super Administrador</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {['admin', 'secretary', 'reseller'].includes(formData.role) && devices.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="device" className="flex items-center gap-2"><Router className="h-4 w-4" />Asignar Dispositivo MikroTik (Opcional)</Label>
                    <Select value={selectedDeviceId || "none"} onValueChange={(value) => setSelectedDeviceId(value === "none" ? "" : value)}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar dispositivo..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin asignar</SelectItem>
                        {devices.map((device: any) => (<SelectItem key={device.id} value={device.id}>{device.name} ({device.host})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => navigate('/admin/users')} className="flex-1">Cancelar</Button>
                  <Button type="submit" disabled={isLoading} className="flex-1">{isLoading ? 'Registrando...' : 'Registrar Usuario'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
