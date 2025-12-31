import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import omnilinkLogo from '@/assets/omnilink-logo.jpeg';

export default function Login() {
  const navigate = useNavigate();
  const { isSecretary, isAuthenticated, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      if (isSecretary) {
        navigate('/ppp');
      } else {
        navigate('/dashboard');
      }
    }
  }, [isAuthenticated, isSecretary, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) throw error;

      // Obtener rol del usuario
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .single();

      // Redirect to dashboard for all users
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left side - Promotional banner with Omnilink */}
      <div className="lg:flex-1 relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-green-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        </div>
        
        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center h-full min-h-[400px] lg:min-h-screen p-8">
          {/* Logo circular */}
          <div className="mb-8 animate-fade-in">
            <div className="w-48 h-48 lg:w-64 lg:h-64 rounded-full overflow-hidden border-4 border-cyan-400/30 shadow-2xl shadow-cyan-500/30 bg-slate-800/50 p-2">
              <img 
                src={omnilinkLogo} 
                alt="OmniLink - Conexión Total, Mundo Digital" 
                className="w-full h-full object-cover rounded-full"
              />
            </div>
          </div>
          
          {/* Promotional message */}
          <div className="text-center space-y-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-cyan-400 via-green-400 to-yellow-400 bg-clip-text text-transparent">
              Bienvenido a OmniLink
            </h1>
            <p className="text-lg lg:text-xl text-slate-300 max-w-md">
              Tu plataforma integral de gestión de redes MikroTik
            </p>
            <div className="flex flex-wrap justify-center gap-4 mt-6">
              <div className="flex items-center gap-2 text-cyan-400">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-sm">Monitoreo en tiempo real</span>
              </div>
              <div className="flex items-center gap-2 text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: '0.5s' }} />
                <span className="text-sm">Gestión simplificada</span>
              </div>
              <div className="flex items-center gap-2 text-yellow-400">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" style={{ animationDelay: '1s' }} />
                <span className="text-sm">Control total</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4 lg:p-8">
        <Card className="w-full max-w-md shadow-xl border-border/50 backdrop-blur-sm">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">Iniciar Sesión</CardTitle>
            <CardDescription>
              Ingresa tus credenciales para acceder al sistema
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  disabled={loading}
                  className="h-11"
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
                  disabled={loading}
                  className="h-11"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={loading}>
                {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                ¿No tienes cuenta?{' '}
                <Link to="/signup" className="text-primary hover:underline font-medium">
                  Regístrate aquí
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
