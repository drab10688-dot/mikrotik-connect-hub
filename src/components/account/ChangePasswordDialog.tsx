import { useState } from "react";
import { authApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

/**
 * Cambio de contraseña del usuario con sesión activa.
 * Disponible tanto en el panel principal (super admin) como dentro de cada ISP.
 */
export const ChangePasswordDialog = ({ trigger }: { trigger?: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) { toast.error("La nueva contraseña debe tener al menos 10 caracteres"); return; }
    if (next !== confirm) { toast.error("Las contraseñas no coinciden"); return; }
    setLoading(true);
    try {
      await authApi.changePassword(current, next);
      toast.success("Contraseña actualizada");
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo cambiar la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <KeyRound className="mr-2 h-4 w-4" />
            Cambiar contraseña
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>Necesitas tu contraseña actual para confirmar el cambio.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-current">Contraseña actual</Label>
            <Input id="cp-current" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-new">Nueva contraseña</Label>
            <Input id="cp-new" type="password" autoComplete="new-password" placeholder="Mínimo 10 caracteres"
              value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-confirm">Repite la nueva contraseña</Label>
            <Input id="cp-confirm" type="password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !current || !next || !confirm}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
