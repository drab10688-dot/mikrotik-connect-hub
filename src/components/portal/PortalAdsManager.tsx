import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { portalAdsApi } from "@/lib/api-client";
import {
  Megaphone, Plus, Pencil, Trash2, BarChart3, Eye, MousePointerClick,
  DollarSign, Calendar, ExternalLink, Store, Image as ImageIcon
} from "lucide-react";

interface PortalAd {
  id: string;
  title: string;
  description?: string;
  image_url?: string;
  link_url?: string;
  advertiser_name: string;
  advertiser_phone?: string;
  advertiser_email?: string;
  position: string;
  is_active: boolean;
  priority: number;
  start_date?: string;
  end_date?: string;
  impressions: number;
  clicks: number;
  monthly_fee: number;
  created_at: string;
}

const emptyAd = {
  title: "", description: "", image_url: "", link_url: "",
  advertiser_name: "", advertiser_phone: "", advertiser_email: "",
  position: "banner", is_active: true, priority: 0,
  start_date: "", end_date: "", monthly_fee: 0,
};

export function PortalAdsManager() {
  const mikrotikId = localStorage.getItem("mikrotik_device_id");
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<PortalAd | null>(null);
  const [form, setForm] = useState(emptyAd);

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ["portal-ads", mikrotikId],
    queryFn: () => portalAdsApi.list(mikrotikId!),
    enabled: !!mikrotikId,
  });

  const { data: stats } = useQuery({
    queryKey: ["portal-ads-stats", mikrotikId],
    queryFn: () => portalAdsApi.stats(mikrotikId!),
    enabled: !!mikrotikId,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (editingAd) {
        return portalAdsApi.update(mikrotikId!, editingAd.id, data);
      }
      return portalAdsApi.create(mikrotikId!, data);
    },
    onSuccess: () => {
      toast.success(editingAd ? "Anuncio actualizado" : "Anuncio creado");
      qc.invalidateQueries({ queryKey: ["portal-ads"] });
      qc.invalidateQueries({ queryKey: ["portal-ads-stats"] });
      closeDialog();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (adId: string) => portalAdsApi.delete(mikrotikId!, adId),
    onSuccess: () => {
      toast.success("Anuncio eliminado");
      qc.invalidateQueries({ queryKey: ["portal-ads"] });
      qc.invalidateQueries({ queryKey: ["portal-ads-stats"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ adId, active }: { adId: string; active: boolean }) =>
      portalAdsApi.update(mikrotikId!, adId, { is_active: active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-ads"] });
      qc.invalidateQueries({ queryKey: ["portal-ads-stats"] });
    },
  });

  const openEdit = (ad: PortalAd) => {
    setEditingAd(ad);
    setForm({
      title: ad.title,
      description: ad.description || "",
      image_url: ad.image_url || "",
      link_url: ad.link_url || "",
      advertiser_name: ad.advertiser_name,
      advertiser_phone: ad.advertiser_phone || "",
      advertiser_email: ad.advertiser_email || "",
      position: ad.position,
      is_active: ad.is_active,
      priority: ad.priority,
      start_date: ad.start_date?.split("T")[0] || "",
      end_date: ad.end_date?.split("T")[0] || "",
      monthly_fee: ad.monthly_fee,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingAd(null);
    setForm(emptyAd);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.advertiser_name.trim()) {
      toast.error("Título y nombre del anunciante son requeridos");
      return;
    }
    saveMutation.mutate(form);
  };

  const positionLabels: Record<string, string> = {
    banner: "Banner Superior",
    sidebar: "Lateral",
    popup: "Popup",
    footer: "Pie de Página",
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para gestionar publicidad.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Megaphone className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Activos</p>
                <p className="text-lg font-bold">{stats.active_ads}/{stats.total_ads}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Eye className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Impresiones</p>
                <p className="text-lg font-bold">{Number(stats.total_impressions).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <MousePointerClick className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clics</p>
                <p className="text-lg font-bold">{Number(stats.total_clicks).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <BarChart3 className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CTR</p>
                <p className="text-lg font-bold">{stats.ctr}%</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ingreso/mes</p>
                <p className="text-lg font-bold">${Number(stats.monthly_revenue).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Megaphone className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Publicidad del Portal</CardTitle>
                <CardDescription>Gestiona anuncios que se muestran en el portal cautivo</CardDescription>
              </div>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
              <DialogTrigger asChild>
                <Button className="gap-2" onClick={() => { setEditingAd(null); setForm(emptyAd); }}>
                  <Plus className="h-4 w-4" />
                  Nuevo Anuncio
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingAd ? "Editar Anuncio" : "Nuevo Anuncio"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Título del anuncio *</Label>
                      <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej: Pizzería Don Mario" />
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre del anunciante *</Label>
                      <Input value={form.advertiser_name} onChange={(e) => setForm({ ...form, advertiser_name: e.target.value })} placeholder="Ej: Juan Pérez / Tienda XYZ" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Descripción</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Texto del anuncio que verán los clientes..." rows={2} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>URL de imagen</Label>
                      <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://ejemplo.com/banner.jpg" />
                    </div>
                    <div className="space-y-2">
                      <Label>URL de destino (click)</Label>
                      <Input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://tienda.com" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Teléfono del anunciante</Label>
                      <Input value={form.advertiser_phone} onChange={(e) => setForm({ ...form, advertiser_phone: e.target.value })} placeholder="+57 300 123 4567" />
                    </div>
                    <div className="space-y-2">
                      <Label>Email del anunciante</Label>
                      <Input type="email" value={form.advertiser_email} onChange={(e) => setForm({ ...form, advertiser_email: e.target.value })} placeholder="contacto@tienda.com" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Posición</Label>
                      <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="banner">Banner Superior</SelectItem>
                          <SelectItem value="footer">Pie de Página</SelectItem>
                          <SelectItem value="popup">Popup</SelectItem>
                          <SelectItem value="sidebar">Lateral</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Prioridad</Label>
                      <Input type="number" min={0} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tarifa mensual</Label>
                      <Input type="number" min={0} value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: parseFloat(e.target.value) || 0 })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Fecha inicio</Label>
                      <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Fecha fin</Label>
                      <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                    </div>
                  </div>

                  {form.image_url && (
                    <div className="rounded-lg border overflow-hidden">
                      <img src={form.image_url} alt="Preview" className="w-full max-h-40 object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                    <Button type="submit" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Guardando..." : editingAd ? "Actualizar" : "Crear Anuncio"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Cargando anuncios...</p>
          ) : ads.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Store className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground">No hay anuncios configurados</p>
              <p className="text-xs text-muted-foreground">Crea anuncios para tiendas o negocios locales que se mostrarán en tu portal cautivo</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anuncio</TableHead>
                    <TableHead>Anunciante</TableHead>
                    <TableHead>Posición</TableHead>
                    <TableHead className="text-center">Impresiones</TableHead>
                    <TableHead className="text-center">Clics</TableHead>
                    <TableHead className="text-center">CTR</TableHead>
                    <TableHead className="text-right">Tarifa</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ads.map((ad: PortalAd) => {
                    const ctr = ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : "0.0";
                    return (
                      <TableRow key={ad.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {ad.image_url ? (
                              <img src={ad.image_url} alt="" className="h-10 w-14 rounded object-cover border" />
                            ) : (
                              <div className="h-10 w-14 rounded bg-muted flex items-center justify-center">
                                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-sm">{ad.title}</p>
                              {ad.description && <p className="text-xs text-muted-foreground line-clamp-1">{ad.description}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{ad.advertiser_name}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{positionLabels[ad.position] || ad.position}</Badge>
                        </TableCell>
                        <TableCell className="text-center text-sm">{ad.impressions.toLocaleString()}</TableCell>
                        <TableCell className="text-center text-sm">{ad.clicks.toLocaleString()}</TableCell>
                        <TableCell className="text-center text-sm">{ctr}%</TableCell>
                        <TableCell className="text-right text-sm font-medium">${ad.monthly_fee.toLocaleString()}</TableCell>
                        <TableCell>
                          <Switch
                            checked={ad.is_active}
                            onCheckedChange={(checked) => toggleMutation.mutate({ adId: ad.id, active: checked })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {ad.link_url && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(ad.link_url!, "_blank")}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(ad)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                              if (confirm("¿Eliminar este anuncio?")) deleteMutation.mutate(ad.id);
                            }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
