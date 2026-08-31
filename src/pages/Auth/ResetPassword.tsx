import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, ArrowLeft } from 'lucide-react';

/** Pantalla pública para crear una nueva contraseña desde el enlace del correo. */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const problem = useMemo(() => {
    if (!token) return 'El enlace no es válido o está incompleto.';
    if (password && password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
    if (confirm && password !== confirm) return 'Las contraseñas no coinciden.';
    return '';
  }, [token, password, confirm]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      toast.success('Contraseña actualizada. Ya puedes entrar.');
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glass-panel w-full max-w-md space-y-5 p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold">Nueva contraseña</h1>
            <p className="text-sm text-muted-foreground">Define una clave segura para tu cuenta</p>
          </div>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/50 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-success" />
              <p className="text-sm text-muted-foreground">
                Tu contraseña se actualizó correctamente. Inicia sesión con la nueva clave.
              </p>
            </div>
            <Button className="w-full" onClick={() => navigate('/login')}>Ir al acceso</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nueva contraseña</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 10 caracteres"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Repite la contraseña</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {problem && <p className="text-sm text-destructive">{problem}</p>}

            <Button type="submit" className="w-full" disabled={loading || !!problem || !password || !confirm}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => navigate('/login')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al acceso
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
