import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { toast } from 'sonner';
import { UserPlus, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function RegisterUser() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'user' as 'super_admin' | 'admin' | 'user',
  });

  // Redirigir si no es super admin
  if (!isSuperAdmin) {
    navigate('/dashboard');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Obtener el token de sesión actual
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No hay sesión activa');
      }

      // Llamar a la edge function para crear el usuario
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          role: formData.role,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success('Usuario registrado exitosamente');
      
      // Limpiar el formulario
      setFormData({
        email: '',
        password: '',
        fullName: '',
        role: 'user',
      });

      // Esperar un momento y redirigir
      setTimeout(() => {
        navigate('/admin/users');
      }, 1500);

    } catch (error: any) {
      console.error('Error al registrar usuario:', error);
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/admin/users')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Registrar Nuevo Usuario</h1>
              <p className="text-muted-foreground">
                Crea una nueva cuenta de usuario en el sistema
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Información del Usuario
              </CardTitle>
              <CardDescription>
                Complete todos los campos para registrar un nuevo usuario
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input
                    id="fullName"
                    placeholder="Juan Pérez"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Correo Electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="usuario@ejemplo.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    minLength={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    Mínimo 6 caracteres
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value: 'super_admin' | 'admin' | 'user') => 
                      setFormData({ ...formData, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuario</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="super_admin">Super Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Define los permisos del usuario en el sistema
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/admin/users')}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1"
                  >
                    {isLoading ? 'Registrando...' : 'Registrar Usuario'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-warning bg-warning/5">
            <CardHeader>
              <CardTitle className="text-sm">Nota Importante</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                • El usuario recibirá un correo de confirmación (si está habilitado en la configuración de auth)
              </p>
              <p>
                • La contraseña debe cumplir con los requisitos mínimos de seguridad
              </p>
              <p>
                • Los Super Administradores tienen acceso completo al sistema
              </p>
              <p>
                • Los Administradores pueden gestionar sus dispositivos asignados
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
