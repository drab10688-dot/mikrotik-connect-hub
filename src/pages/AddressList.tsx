import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Plus, Ban, Shield, AlertCircle, ListPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { mikrotikCommandApi } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const AddressList = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCreateListDialogOpen, setIsCreateListDialogOpen] = useState(false);
  const [deleteListName, setDeleteListName] = useState<string | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [formData, setFormData] = useState({ addresses: "", list: "", comment: "" });
  const [newListName, setNewListName] = useState("");
  const mikrotikId = getSelectedDeviceId();

  const { data: addressEntries, isLoading, refetch } = useQuery({
    queryKey: ["address-list-entries", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      const data = await mikrotikCommandApi.exec(mikrotikId, "address-list-print");
      if (!data.success) throw new Error(data.error);
      return data.data || [];
    },
    enabled: !!mikrotikId,
    refetchInterval: 5000,
  });

  const groupedByList = (addressEntries || []).reduce((acc: any, entry: any) => {
    const listName = entry.list || "Sin lista";
    if (!acc[listName]) acc[listName] = [];
    acc[listName].push(entry);
    return acc;
  }, {});

  const availableLists = Object.keys(groupedByList).sort();
  const filteredLists = availableLists.filter(listName => {
    const lowerSearch = searchTerm.toLowerCase();
    return listName.toLowerCase().includes(lowerSearch) || groupedByList[listName].some((entry: any) => entry.address?.toLowerCase().includes(lowerSearch));
  });

  const expandIPRange = (input: string): string[] => {
    const lines = input.split("\n").filter(line => line.trim());
    const expandedIPs: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/);
      if (rangeMatch) {
        const startParts = rangeMatch[1].split('.').map(Number);
        const endParts = rangeMatch[2].split('.').map(Number);
        if (startParts[0] === endParts[0] && startParts[1] === endParts[1] && startParts[2] === endParts[2]) {
          for (let i = startParts[3]; i <= endParts[3] && i <= 255; i++) expandedIPs.push(`${startParts[0]}.${startParts[1]}.${startParts[2]}.${i}`);
        } else expandedIPs.push(trimmed);
      } else expandedIPs.push(trimmed);
    }
    return expandedIPs;
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) { toast.error("Ingresa un nombre para la lista"); return; }
    if (!mikrotikId) { toast.error("No hay dispositivo MikroTik seleccionado"); return; }
    try {
      const data = await mikrotikCommandApi.exec(mikrotikId, "address-list-add", { list: newListName.trim(), address: "0.0.0.0", comment: "Lista creada - eliminar esta entrada después de agregar IPs reales" });
      if (!data.success) throw new Error(data.error);
      toast.success(`Lista "${newListName}" creada exitosamente`);
      setNewListName(""); setIsCreateListDialogOpen(false); refetch();
    } catch (error: any) { toast.error(error.message || "Error al crear lista"); }
  };

  const handleAddIPs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.list.trim() || !mikrotikId) { toast.error("Selecciona una lista"); return; }
    const loadingToast = toast.loading("Agregando IPs...");
    try {
      const addressList = isBulkMode ? expandIPRange(formData.addresses) : formData.addresses.split("\n").filter(addr => addr.trim());
      if (addressList.length === 0) { toast.error("Ingresa al menos una dirección"); toast.dismiss(loadingToast); return; }
      let successCount = 0, duplicateCount = 0;
      for (const address of addressList) {
        try {
          const data = await mikrotikCommandApi.exec(mikrotikId, "address-list-add", { address: address.trim(), list: formData.list, comment: formData.comment || undefined });
          if (data && !data.success && data.error?.includes("already have such entry")) duplicateCount++;
          else successCount++;
        } catch (err: any) { if (err?.message?.includes("already have such entry")) duplicateCount++; }
      }
      toast.dismiss(loadingToast);
      if (successCount > 0) toast.success(`${successCount} IP(s) agregada(s) exitosamente`);
      if (duplicateCount > 0) toast.info(`${duplicateCount} IP(s) ya existían`);
      setIsAddDialogOpen(false); setFormData({ addresses: "", list: "", comment: "" }); setIsBulkMode(false); refetch();
    } catch (error: any) { toast.dismiss(loadingToast); toast.error(error.message || "Error al agregar IPs"); }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!mikrotikId) return;
    try {
      const data = await mikrotikCommandApi.exec(mikrotikId, "address-list-remove", { ".id": entryId });
      if (!data.success) throw new Error(data.error);
      toast.success("IP eliminada"); refetch();
    } catch (error: any) { toast.error(error.message || "Error al eliminar IP"); }
  };

  const handleDeleteList = async () => {
    if (!deleteListName || !mikrotikId) return;
    const entriesToDelete = groupedByList[deleteListName] || [];
    if (entriesToDelete.length === 0) { setDeleteListName(null); return; }
    const loadingToast = toast.loading(`Eliminando ${entriesToDelete.length} entrada(s)...`);
    try {
      let successCount = 0;
      for (const entry of entriesToDelete) {
        try { const data = await mikrotikCommandApi.exec(mikrotikId, "address-list-remove", { ".id": entry[".id"] }); if (data?.success) successCount++; } catch {}
      }
      toast.dismiss(loadingToast);
      toast.success(`Lista "${deleteListName}" eliminada - ${successCount} entrada(s) eliminada(s)`);
      setDeleteListName(null); refetch();
    } catch (error: any) { toast.dismiss(loadingToast); toast.error(error.message || "Error al eliminar lista"); }
  };

  if (!mikrotikId) {
    return (<div className="min-h-screen bg-background"><Sidebar /><div className="p-4 md:p-8 md:ml-64"><Card><CardContent className="flex items-center justify-center py-12"><div className="text-center"><AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><h3 className="text-lg font-medium">Sin conexión</h3><p className="text-muted-foreground">Conecta un dispositivo MikroTik desde Configuración</p></div></CardContent></Card></div></div>);
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <div className="mb-6 md:mb-8"><h1 className="text-2xl md:text-3xl font-bold text-foreground">Address Lists</h1><p className="text-muted-foreground">Gestiona listas de direcciones IP bloqueadas o permitidas</p></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Total Listas</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{availableLists.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Total IPs</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{addressEntries?.length || 0}</div></CardContent></Card>
          <Card><CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Listas Activas</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{availableLists.filter(l => l !== "Sin lista").length}</div></CardContent></Card>
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div><CardTitle>Gestión de Listas</CardTitle><CardDescription>Administra tus address lists y las IPs bloqueadas</CardDescription></div>
              <div className="flex gap-2">
                <Dialog open={isCreateListDialogOpen} onOpenChange={setIsCreateListDialogOpen}>
                  <DialogTrigger asChild><Button variant="outline"><ListPlus className="w-4 h-4 mr-2" />Nueva Lista</Button></DialogTrigger>
                  <DialogContent><DialogHeader><DialogTitle>Crear Nueva Lista</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Nombre de la Lista *</Label><Input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="ej: Morosos" /></div><div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => setIsCreateListDialogOpen(false)}>Cancelar</Button><Button onClick={handleCreateList}><Plus className="w-4 h-4 mr-2" />Crear Lista</Button></div></div></DialogContent>
                </Dialog>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Agregar IPs</Button></DialogTrigger>
                  <DialogContent><DialogHeader><DialogTitle>Agregar IPs a Lista</DialogTitle></DialogHeader>
                    <form onSubmit={handleAddIPs} className="space-y-4">
                      <div className="space-y-2"><Label>Lista Destino *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.list} onChange={(e) => setFormData({ ...formData, list: e.target.value })} required><option value="">Selecciona una lista</option>{availableLists.map((list) => (<option key={list} value={list}>{list}</option>))}</select></div>
                      <div className="space-y-2"><Label>Direcciones IP *</Label><Textarea value={formData.addresses} onChange={(e) => setFormData({ ...formData, addresses: e.target.value })} placeholder={isBulkMode ? "192.168.100.2\no rango:\n192.168.100.2 - 192.168.100.60" : "192.168.1.100"} rows={isBulkMode ? 6 : 2} required /><Button type="button" variant="outline" size="sm" onClick={() => setIsBulkMode(!isBulkMode)}>{isBulkMode ? "Modo Simple" : "Modo Bloque/Rango"}</Button></div>
                      <div className="space-y-2"><Label>Comentario (Opcional)</Label><Input value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} placeholder="Descripción o motivo" /></div>
                      <div className="flex gap-2 justify-end"><Button variant="outline" type="button" onClick={() => setIsAddDialogOpen(false)}>Cancelar</Button><Button type="submit"><Plus className="w-4 h-4 mr-2" />Agregar</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4"><div className="relative"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" /><Input placeholder="Buscar por nombre de lista o IP..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></div>
            {isLoading ? <div className="text-center p-8 text-muted-foreground">Cargando listas...</div>
            : filteredLists.length === 0 ? <div className="text-center p-8 text-muted-foreground">No hay listas de direcciones configuradas</div>
            : (
              <Accordion type="multiple" className="w-full">
                {filteredLists.map((listName) => {
                  const entries = groupedByList[listName] || [];
                  const isBlockList = listName.toLowerCase().includes('block') || listName.toLowerCase().includes('moroso') || listName.toLowerCase().includes('suspend');
                  return (
                    <AccordionItem key={listName} value={listName}>
                      <AccordionTrigger className="hover:no-underline"><div className="flex items-center gap-3">{isBlockList ? <Ban className="w-5 h-5 text-destructive" /> : <Shield className="w-5 h-5 text-primary" />}<span className="font-medium">{listName}</span><Badge variant="secondary">{entries.length} IPs</Badge></div></AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 pt-2">
                          <div className="flex justify-end mb-2"><Button variant="destructive" size="sm" onClick={() => setDeleteListName(listName)}><Trash2 className="w-4 h-4 mr-2" />Eliminar Lista Completa</Button></div>
                          <div className="rounded-md border"><table className="w-full"><thead><tr className="border-b bg-muted/50"><th className="p-2 text-left text-sm font-medium">Dirección</th><th className="p-2 text-left text-sm font-medium">Comentario</th><th className="p-2 text-right text-sm font-medium">Acciones</th></tr></thead>
                            <tbody>{entries.map((entry: any, idx: number) => (<tr key={entry[".id"] || idx} className="border-b last:border-0"><td className="p-2 font-mono text-sm">{entry.address}</td><td className="p-2 text-sm text-muted-foreground">{entry.comment || "-"}</td><td className="p-2 text-right"><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteEntry(entry[".id"])}><X className="w-4 h-4" /></Button></td></tr>))}</tbody>
                          </table></div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>
      <AlertDialog open={!!deleteListName} onOpenChange={() => setDeleteListName(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar lista "{deleteListName}"?</AlertDialogTitle><AlertDialogDescription>Esta acción eliminará todas las {groupedByList[deleteListName || ""]?.length || 0} IPs de esta lista.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleDeleteList} className="bg-destructive hover:bg-destructive/90">Eliminar Lista</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AddressList;
