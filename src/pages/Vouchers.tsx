import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Ticket, Plus, Trash2, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { generateVouchers, getVouchers, deleteVoucher } from "@/lib/mikrotik";
import { useVouchers } from "@/hooks/useMikrotikData";
import { PrintVouchersDialog } from "@/components/vouchers/PrintVouchersDialog";

const Vouchers = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [voucherCount, setVoucherCount] = useState("10");
  const [voucherProfile, setVoucherProfile] = useState("default");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVouchers, setSelectedVouchers] = useState<Set<string>>(new Set());
  
  const { data: vouchers, isLoading, refetch } = useVouchers();

  const toggleVoucherSelection = (id: string) => {
    const newSelection = new Set(selectedVouchers);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedVouchers(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedVouchers.size === filteredVouchers.length) {
      setSelectedVouchers(new Set());
    } else {
      setSelectedVouchers(new Set(filteredVouchers.map((v: any) => v[".id"])));
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await generateVouchers(parseInt(voucherCount), voucherProfile);
      toast.success(`${voucherCount} vouchers generados exitosamente`);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al generar vouchers");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVoucher(id);
      toast.success("Voucher eliminado");
      refetch();
      // Remover de la selección si estaba seleccionado
      const newSelection = new Set(selectedVouchers);
      newSelection.delete(id);
      setSelectedVouchers(newSelection);
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar voucher");
    }
  };

  const handleExport = () => {
    if (!vouchers) return;
    
    const csv = [
      ["Usuario", "Contraseña", "Perfil"].join(","),
      ...vouchers.map((v: any) => 
        [v.name, v.password, v.profile || "default"].join(",")
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vouchers-${new Date().toISOString()}.csv`;
    a.click();
    toast.success("Vouchers exportados");
  };

  const filteredVouchers = vouchers?.filter((v: any) => 
    v.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.comment?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <Ticket className="w-8 h-8 text-primary" />
                Gestión de Vouchers
              </h1>
              <p className="text-muted-foreground mt-1">
                Genera y administra códigos de acceso hotspot
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Generar Vouchers</CardTitle>
                <CardDescription>Crea códigos de acceso en masa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="count">Cantidad</Label>
                  <Input
                    id="count"
                    type="number"
                    min="1"
                    max="100"
                    value={voucherCount}
                    onChange={(e) => setVoucherCount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile">Perfil</Label>
                  <Select value={voucherProfile} onValueChange={setVoucherProfile}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">default</SelectItem>
                      <SelectItem value="1hora">1 hora</SelectItem>
                      <SelectItem value="3horas">3 horas</SelectItem>
                      <SelectItem value="1dia">1 día</SelectItem>
                      <SelectItem value="1semana">1 semana</SelectItem>
                      <SelectItem value="1mes">1 mes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={handleGenerate} 
                  disabled={isGenerating}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {isGenerating ? "Generando..." : "Generar Vouchers"}
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Estadísticas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-primary">{vouchers?.length || 0}</p>
                    <p className="text-sm text-muted-foreground">Total vouchers</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold text-green-500">
                      {vouchers?.filter((v: any) => !v.disabled).length || 0}
                    </p>
                    <p className="text-sm text-muted-foreground">Activos</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold text-red-500">
                      {vouchers?.filter((v: any) => v.disabled).length || 0}
                    </p>
                    <p className="text-sm text-muted-foreground">Deshabilitados</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Lista de Vouchers</CardTitle>
                <div className="flex gap-2">
                  {selectedVouchers.size > 0 && (
                    <PrintVouchersDialog 
                      vouchers={filteredVouchers.filter((v: any) => selectedVouchers.has(v[".id"]))} 
                    />
                  )}
                  <Button variant="outline" onClick={handleExport}>
                    <Download className="w-4 h-4 mr-2" />
                    Exportar
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {selectedVouchers.size > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {selectedVouchers.size} seleccionado(s)
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="w-12 p-4">
                        <Checkbox
                          checked={selectedVouchers.size === filteredVouchers.length && filteredVouchers.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="text-left p-4 font-medium">Usuario</th>
                      <th className="text-left p-4 font-medium">Contraseña</th>
                      <th className="text-left p-4 font-medium">Perfil</th>
                      <th className="text-left p-4 font-medium">Comentario</th>
                      <th className="text-right p-4 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-muted-foreground">
                          Cargando vouchers...
                        </td>
                      </tr>
                    ) : filteredVouchers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-muted-foreground">
                          No hay vouchers disponibles
                        </td>
                      </tr>
                    ) : (
                      filteredVouchers.map((voucher: any) => (
                        <tr key={voucher[".id"]} className="border-b hover:bg-muted/50">
                          <td className="p-4">
                            <Checkbox
                              checked={selectedVouchers.has(voucher[".id"])}
                              onCheckedChange={() => toggleVoucherSelection(voucher[".id"])}
                            />
                          </td>
                          <td className="p-4 font-mono text-sm">{voucher.name}</td>
                          <td className="p-4 font-mono text-sm">{voucher.password}</td>
                          <td className="p-4">{voucher.profile || "default"}</td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {voucher.comment || "-"}
                          </td>
                          <td className="p-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(voucher[".id"])}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Vouchers;
