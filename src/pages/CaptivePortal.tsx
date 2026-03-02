import { useState, useEffect } from "react";
import { Wifi, ArrowRight, Loader2, CheckCircle2, AlertCircle, Globe, Signal, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { hotspotLoginApi } from "@/lib/api-client";
import { toast } from "sonner";
import omnisyncLogo from "@/assets/omnisync-sphere.png";

type PortalStatus = "idle" | "loading" | "success" | "error";

export default function CaptivePortal() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<PortalStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [mikrotikId, setMikrotikId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || params.get("mikrotik");
    if (id) setMikrotikId(id);
    const u = params.get("username"); const p = params.get("password");
    if (u) setUsername(u); if (p) setPassword(p);
  }, []);

  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { toast.error("Ingresa usuario y contraseña"); return; }
    if (!mikrotikId) { toast.error("Dispositivo no configurado"); return; }
    setStatus("loading"); setErrorMsg("");
    try {
      const data = await hotspotLoginApi.login(mikrotikId, username.trim(), password.trim());
      if (!data?.success) { setStatus("error"); setErrorMsg(data?.error || "Error de autenticación"); return; }
      setStatus("success");
      const hotspotUrl = data.data.hotspotUrl;
      const loginUrl = `${hotspotUrl}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      toast.success("¡Autenticación exitosa! Conectando...");
      setTimeout(() => { window.location.href = loginUrl; }, 1500);
    } catch (err: any) { setStatus("error"); setErrorMsg(err.message || "Error de conexión"); }
  };

  const formattedTime = currentTime.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const formattedDate = currentTime.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, hsl(220 25% 8%) 0%, hsl(217 40% 12%) 30%, hsl(220 30% 10%) 60%, hsl(217 35% 15%) 100%)" }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full opacity-10 animate-pulse" style={{ background: "radial-gradient(circle, hsl(217 91% 60% / 0.4), transparent 70%)" }} />
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full opacity-10 animate-pulse" style={{ background: "radial-gradient(circle, hsl(190 85% 45% / 0.3), transparent 70%)", animationDelay: "1s" }} />
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-10">
        <div className="flex items-center gap-2"><Signal className="h-4 w-4" style={{ color: "hsl(142 76% 45%)" }} /><span className="text-xs font-medium" style={{ color: "hsl(220 10% 60%)" }}>WiFi Conectado</span></div>
        <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" style={{ color: "hsl(220 10% 50%)" }} /><span className="text-xs font-mono" style={{ color: "hsl(220 10% 60%)" }}>{formattedTime}</span></div>
      </div>
      <Card className="w-full max-w-md relative z-10 border-0 shadow-2xl" style={{ background: "linear-gradient(180deg, hsl(220 20% 14% / 0.95), hsl(220 25% 10% / 0.98))", backdropFilter: "blur(20px)", boxShadow: "0 25px 60px -12px hsl(217 91% 60% / 0.15), 0 0 0 1px hsl(220 15% 20% / 0.5)" }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px" style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.5), transparent)" }} />
        <div className="p-8 space-y-8">
          <div className="text-center space-y-3">
            <div className="flex justify-center"><div className="relative"><img src={omnisyncLogo} alt="Logo" className="h-20 w-20 object-contain rounded-full" style={{ filter: "drop-shadow(0 0 20px hsl(217 91% 60% / 0.3))" }} /></div></div>
            <div><h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(0 0% 95%)" }}>Portal de Acceso</h1><p className="text-sm mt-1" style={{ color: "hsl(220 10% 50%)" }}>Ingresa tus credenciales para conectarte a Internet</p></div>
          </div>
          <div className="text-center"><p className="text-xs capitalize" style={{ color: "hsl(220 10% 45%)" }}>{formattedDate}</p></div>
          {status === "success" ? (
            <div className="text-center space-y-4 py-6"><div className="flex justify-center"><div className="rounded-full p-4" style={{ background: "hsl(142 76% 45% / 0.15)" }}><CheckCircle2 className="h-12 w-12" style={{ color: "hsl(142 76% 45%)" }} /></div></div><p className="text-lg font-semibold" style={{ color: "hsl(0 0% 95%)" }}>¡Conectado exitosamente!</p><Loader2 className="h-5 w-5 animate-spin mx-auto" style={{ color: "hsl(142 76% 45%)" }} /></div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-4">
                <div className="space-y-2"><label className="text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(220 10% 55%)" }}>Usuario / PIN</label><Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ingresa tu usuario o PIN" disabled={status === "loading"} className="h-12 border-0 text-base" style={{ background: "hsl(220 20% 8% / 0.8)", color: "hsl(0 0% 95%)", boxShadow: "inset 0 0 0 1px hsl(220 15% 22%)" }} autoComplete="username" autoFocus /></div>
                <div className="space-y-2"><label className="text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(220 10% 55%)" }}>Contraseña</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresa tu contraseña" disabled={status === "loading"} className="h-12 border-0 text-base" style={{ background: "hsl(220 20% 8% / 0.8)", color: "hsl(0 0% 95%)", boxShadow: "inset 0 0 0 1px hsl(220 15% 22%)" }} autoComplete="current-password" /></div>
              </div>
              {status === "error" && <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "hsl(0 84% 60% / 0.1)", border: "1px solid hsl(0 84% 60% / 0.2)" }}><AlertCircle className="h-4 w-4 shrink-0" style={{ color: "hsl(0 84% 60%)" }} /><p className="text-sm" style={{ color: "hsl(0 84% 70%)" }}>{errorMsg}</p></div>}
              <Button type="submit" disabled={status === "loading" || !username.trim() || !password.trim()} className="w-full h-12 text-base font-semibold border-0" style={{ background: status === "loading" ? "hsl(217 91% 50% / 0.5)" : "linear-gradient(135deg, hsl(217 91% 55%), hsl(217 91% 45%))", color: "hsl(0 0% 100%)", boxShadow: status === "loading" ? "none" : "0 4px 14px 0 hsl(217 91% 60% / 0.35)" }}>
                {status === "loading" ? <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Verificando...</span> : <span className="flex items-center gap-2"><Wifi className="h-5 w-5" />Conectarse a Internet<ArrowRight className="h-4 w-4" /></span>}
              </Button>
            </form>
          )}
          <div className="pt-4 border-t" style={{ borderColor: "hsl(220 15% 18%)" }}><div className="flex items-center justify-between"><div className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" style={{ color: "hsl(220 10% 40%)" }} /><span className="text-[11px]" style={{ color: "hsl(220 10% 40%)" }}>Portal Seguro</span></div><span className="text-[11px]" style={{ color: "hsl(220 10% 35%)" }}>Powered by OmniSync</span></div></div>
        </div>
      </Card>
    </div>
  );
}
