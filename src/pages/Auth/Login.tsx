import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { LogIn, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import omnisyncLogo from '@/assets/omnisync-logo.png';

export default function Login() {
  const navigate = useNavigate();
  const { isSecretary, isAuthenticated, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
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

  // Landing promocional
  if (!showForm) {
    return (
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-green-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
          <div className="absolute bottom-1/3 left-1/3 w-72 h-72 bg-yellow-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
        </div>
        
        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-8">
          {/* Logo circular grande */}
          <div className="mb-8 animate-fade-in">
            <div className="w-56 h-56 md:w-72 md:h-72 lg:w-80 lg:h-80 rounded-full overflow-hidden border-4 border-cyan-400/40 shadow-2xl shadow-cyan-500/40 bg-slate-800/50 p-3 hover:scale-105 transition-transform duration-500">
               <img 
                 src={omnisyncLogo} 
                 alt="Omnisync" 
                 className="w-full h-full object-cover rounded-full"
               />
            </div>
          </div>
          
          {/* Promotional message */}
          <div className="text-center space-y-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <p className="text-base md:text-lg text-slate-400 max-w-md">
              Tu plataforma integral de gestión de redes MikroTik
            </p>
            
            {/* Features */}
            <div className="flex flex-wrap justify-center gap-6 mt-8">
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

            {/* Login button */}
            <div className="mt-10 animate-fade-in" style={{ animationDelay: '0.6s' }}>
              <Button 
                onClick={() => setShowForm(true)}
                size="lg"
                className="h-14 px-10 text-lg font-semibold bg-gradient-to-r from-cyan-500 to-green-500 hover:from-cyan-600 hover:to-green-600 text-white shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-all duration-300 hover:scale-105"
              >
                <LogIn className="w-5 h-5 mr-2" />
                Iniciar Sesión
              </Button>
            </div>

            <p className="text-sm text-slate-500 mt-6">
              ¿No tienes cuenta?{' '}
              <Link to="/signup" className="text-cyan-400 hover:text-cyan-300 hover:underline font-medium transition-colors">
                Regístrate aquí
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Formulario de login
  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>
      
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4">
        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => setShowForm(false)}
          className="absolute top-6 left-6 text-slate-400 hover:text-white hover:bg-slate-800/50"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Volver
        </Button>

        {/* Logo */}
        <div className="mb-6 animate-fade-in">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-3 border-cyan-400/40 shadow-xl shadow-cyan-500/30 bg-slate-800/50 p-2">
             <img 
               src={omnisyncLogo} 
               alt="Omnisync" 
               className="w-full h-full object-cover rounded-full"
             />
          </div>
        </div>

        <Card className="w-full max-w-md shadow-2xl border-slate-700/50 bg-slate-800/80 backdrop-blur-xl animate-fade-in">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold text-white">Iniciar Sesión</CardTitle>
            <CardDescription className="text-slate-400">
              Ingresa tus credenciales para acceder al sistema
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  disabled={loading}
                  className="h-11 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-cyan-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  disabled={loading}
                  className="h-11 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-cyan-500"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button 
                type="submit" 
                className="w-full h-11 text-base font-semibold bg-gradient-to-r from-cyan-500 to-green-500 hover:from-cyan-600 hover:to-green-600" 
                disabled={loading}
              >
                {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </Button>
              <p className="text-sm text-center text-slate-400">
                ¿No tienes cuenta?{' '}
                <Link to="/signup" className="text-cyan-400 hover:text-cyan-300 hover:underline font-medium transition-colors">
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
