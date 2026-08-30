import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { authApi, setToken, setStoredUser, setApiBaseUrl } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { LogIn, ArrowLeft, Antenna, Network, ShieldCheck, Wifi, Radio } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import omnisyncLogoAsset from '@/assets/omnisync-logo.png.asset.json';
const omnisyncSphereUrl = omnisyncLogoAsset.url;
import { usePublicTenant, setStoredTenantSlug } from '@/hooks/useTenantBranding';
import { mergeLanding } from '@/lib/landing';


const FEATURE_ICONS = [Antenna, Network, Wifi, ShieldCheck];

/** Reto anti-bot simple (suma aleatoria). */
const newChallenge = () => ({
  a: Math.floor(Math.random() * 9) + 1,
  b: Math.floor(Math.random() * 9) + 1,
});


/** Fondo técnico compartido: rejilla, auroras y anillos de señal. */
const TechBackdrop = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
    <div
      className="absolute inset-0 opacity-[0.35]"
      style={{
        backgroundImage:
          'linear-gradient(hsl(var(--primary) / 0.10) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.10) 1px, transparent 1px)',
        backgroundSize: '54px 54px',
        maskImage: 'radial-gradient(ellipse 80% 70% at 30% 20%, black 10%, transparent 75%)',
      }}
    />
    <div className="absolute -top-40 -left-24 h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-[120px] animate-aurora" />
    <div className="absolute bottom-[-14rem] right-[-8rem] h-[34rem] w-[34rem] rounded-full bg-accent/20 blur-[130px] animate-aurora [animation-delay:4s]" />
    <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-primary-glow/15 blur-[100px] animate-aurora [animation-delay:8s]" />
  </div>
);

export default function Login() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const { tenant } = usePublicTenant(slug);
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [apiUrl] = useState('');
  const [challenge, setChallenge] = useState(newChallenge);
  const [answer, setAnswer] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  const lockedSeconds = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const isLocked = lockedSeconds > 0;

  useEffect(() => {
    if (slug) setStoredTenantSlug(slug);
  }, [slug]);

  const brandName = tenant?.name || 'OmniACS';
  const landing = mergeLanding((tenant as any)?.landing);
  const brandLogo = tenant?.logo_url || null;

  useEffect(() => {
    if (isAuthenticated && !authLoading) navigate('/dashboard');
  }, [isAuthenticated, authLoading, navigate]);

  const resetChallenge = () => {
    setChallenge(newChallenge());
    setAnswer('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

    // Honeypot: los bots rellenan campos ocultos
    if (honeypot.trim()) {
      toast.error('Verificación fallida.');
      return;
    }
    if (Number(answer) !== challenge.a + challenge.b) {
      toast.error('Respuesta de verificación incorrecta.');
      resetChallenge();
      return;
    }

    setLoading(true);
    try {
      if (apiUrl.trim()) setApiBaseUrl(apiUrl.trim());
      const { token, user } = await authApi.login(formData.email.trim(), formData.password);
      setToken(token);
      setStoredUser(user);
      setFails(0);
      navigate('/dashboard');
    } catch (error: any) {
      const next = fails + 1;
      setFails(next);
      resetChallenge();
      if (error?.status === 429) {
        const secs = Number(error?.data?.retry_after) || 900;
        setLockUntil(Date.now() + secs * 1000);
        setNow(Date.now());
        toast.error(error.message || 'Demasiados intentos. Espera unos minutos.');
      } else if (next >= 5) {
        setLockUntil(Date.now() + 60_000);
        setNow(Date.now());
        setFails(0);
        toast.error('Demasiados intentos fallidos. Espera 1 minuto.');
      } else if (error?.status === 404) {
        toast.error('No se encontró la API. Ingresa la URL de tu VPS (ej: https://tu-dominio.com)');
      } else {
        toast.error(error.message || 'Error al iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  };


  const Brand = ({ size = 'lg' }: { size?: 'lg' | 'sm' }) => (
    <div className={`flex flex-col gap-2 ${size === 'lg' ? 'items-start' : 'items-center'}`}>
      <div className="relative grid place-items-center h-40 w-40 sm:h-52 sm:w-52 rounded-full overflow-hidden ring-2 ring-primary/30 shadow-[0_0_36px_hsl(var(--primary)/0.40)] bg-background">
        <img
          src={brandLogo || omnisyncSphereUrl}
          alt={brandName}
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );

  const LoginForm = (
    <div className="glass-panel glass-panel-glow hairline-top w-full max-w-md p-7 animate-fade-in-up">
      <div className="mb-6 space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Acceso al panel</h2>
        <p className="text-sm text-muted-foreground">Ingresa tus credenciales para entrar a la consola.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            placeholder="operador@tuisp.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            disabled={loading}
            className="h-11 bg-background/60"
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
            className="h-11 bg-background/60"
          />
        </div>

        {/* Honeypot invisible para bots */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="hidden"
          aria-hidden
        />

        <div className="space-y-2 rounded-xl border border-border/60 bg-background/40 p-3">
          <Label htmlFor="captcha" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Verificación de seguridad
          </Label>
          <div className="flex items-center gap-3">
            <span className="select-none rounded-lg bg-primary/10 px-3 py-2 font-mono text-base font-semibold text-primary ring-1 ring-primary/25">
              {challenge.a} + {challenge.b} = ?
            </span>
            <Input
              id="captcha"
              inputMode="numeric"
              placeholder="Resultado"
              value={answer}
              onChange={(e) => setAnswer(e.target.value.replace(/\D/g, '').slice(0, 3))}
              required
              disabled={loading || isLocked}
              className="h-10 flex-1 bg-background/60"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading || isLocked}
          className="w-full h-11 font-semibold"
        >
          <LogIn className="mr-2 h-4 w-4" />
          {isLocked ? `Bloqueado ${lockedSeconds}s` : loading ? 'Verificando…' : 'Entrar'}
        </Button>
      </form>
    </div>

  );

  // ── Landing comercial ───────────────────────────────────────
  if (!showForm) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <TechBackdrop />

        <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Columna de venta */}
          <div className="space-y-8 animate-fade-in-up">
            <Brand />

            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <Radio className="h-3.5 w-3.5" />
                {landing.badge}
              </span>
              <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                {landing.headline} <span className="brand-text">{landing.highlight}</span>
              </h1>
              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                {landing.subheadline}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => setShowForm(true)}
                className="h-14 px-10 text-lg font-bold shadow-primary ring-2 ring-primary/40"
              >
                <LogIn className="mr-2 h-5 w-5" />
                {landing.cta}
              </Button>
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
                <span className="status-dot text-success" />
                Servicio operativo
              </div>
            </div>

            <div className="grid max-w-lg grid-cols-3 gap-3">
              {landing.metrics.map((m) => (
                <div key={m.label} className="glass-panel px-4 py-3 text-center">
                  <p className="text-xl font-bold text-gradient-primary">{m.value}</p>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Columna de capacidades */}
          <div className="grid gap-4 sm:grid-cols-2">
            {landing.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
              <div
                key={f.title}
                className="glass-panel group p-5 transition-smooth hover:-translate-y-1 hover:glass-panel-glow animate-fade-in-up"
                style={{ animationDelay: `${120 + i * 90}ms` }}
              >
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25 transition-smooth group-hover:scale-105">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="font-semibold">{f.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </div>
              );
            })}

          </div>
        </div>
      </div>
    );
  }

  // ── Pantalla de acceso ──────────────────────────────────────
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <TechBackdrop />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
        <Button
          variant="ghost"
          onClick={() => setShowForm(false)}
          className="absolute left-4 top-5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>

        <Brand size="sm" />
        {LoginForm}
      </div>
    </div>
  );
}
