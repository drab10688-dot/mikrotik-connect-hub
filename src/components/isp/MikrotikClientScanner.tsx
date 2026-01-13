import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  Loader2, 
  Scan, 
  Download, 
  Users, 
  Wifi, 
  Network,
  AlertCircle,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { getSuspensionAddressList } from "@/components/isp/contracts/ContractTermsEditor";

interface ScannedClient {
  name: string;
  ip: string;
  type: 'pppoe' | 'queue';
  profile?: string;
  speed?: string;
  comment?: string;
  disabled?: boolean;
  mikrotikId?: string;
}

interface ScanResult {
  total: number;
  unregistered: ScannedClient[];
  registered: number;
}

export function MikrotikClientScanner() {
  const mikrotikId = getSelectedDeviceId();
  const queryClient = useQueryClient();
  
  const [scanType, setScanType] = useState<'all' | 'pppoe' | 'queue'>('all');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Scan mutation
  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('mikrotik-scan-clients', {
        body: { mikrotikId, scanType },
      });
      
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data.data as ScanResult;
    },
    onSuccess: (data) => {
      setScanResult(data);
      setSelectedClients(new Set());
      toast.success(`Escaneo completado: ${data.unregistered.length} clientes sin registrar de ${data.total} total`);
    },
    onError: (error: any) => {
      toast.error(`Error al escanear: ${error.message}`);
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (clients: ScannedClient[]) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("No autenticado");

      const results = { success: 0, errors: [] as string[] };

      for (const client of clients) {
        try {
          const { error } = await supabase.from('isp_clients').insert({
            mikrotik_id: mikrotikId,
            created_by: userData.user.id,
            client_name: client.name,
            username: client.name,
            assigned_ip: client.ip,
            connection_type: client.type === 'pppoe' ? 'pppoe' : 'simple_queue',
            plan_or_speed: client.profile || client.speed || null,
            comment: client.comment || null,
            is_potential_client: false,
          });

          if (error) {
            results.errors.push(`${client.name}: ${error.message}`);
          } else {
            results.success++;
          }
        } catch (err: any) {
          results.errors.push(`${client.name}: ${err.message}`);
        }
      }

      return results;
    },
    onSuccess: (results) => {
      if (results.success > 0) {
        toast.success(`${results.success} clientes importados correctamente`);
        queryClient.invalidateQueries({ queryKey: ['isp-clients'] });
        // Re-scan to update the list
        scanMutation.mutate();
      }
      if (results.errors.length > 0) {
        console.error('Import errors:', results.errors);
        toast.error(`${results.errors.length} errores al importar`);
      }
      setSelectedClients(new Set());
    },
    onError: (error: any) => {
      toast.error(`Error al importar: ${error.message}`);
    },
  });

  const toggleSelectAll = () => {
    if (!scanResult) return;
    const filtered = filteredClients;
    if (selectedClients.size === filtered.length) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(new Set(filtered.map(c => `${c.name}-${c.ip}`)));
    }
  };

  const toggleClient = (client: ScannedClient) => {
    const key = `${client.name}-${client.ip}`;
    const newSelected = new Set(selectedClients);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedClients(newSelected);
  };

  const handleImportSelected = () => {
    if (!scanResult) return;
    const clientsToImport = scanResult.unregistered.filter(
      c => selectedClients.has(`${c.name}-${c.ip}`)
    );
    if (clientsToImport.length === 0) {
      toast.error("Selecciona al menos un cliente para importar");
      return;
    }
    importMutation.mutate(clientsToImport);
  };

  const handleImportAll = () => {
    if (!scanResult || scanResult.unregistered.length === 0) {
      toast.error("No hay clientes para importar");
      return;
    }
    importMutation.mutate(scanResult.unregistered);
  };

  const filteredClients = scanResult?.unregistered.filter(client => {
    const term = searchTerm.toLowerCase();
    return (
      client.name.toLowerCase().includes(term) ||
      client.ip.toLowerCase().includes(term) ||
      (client.comment || '').toLowerCase().includes(term)
    );
  }) || [];

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Sin conexión</h3>
            <p className="text-muted-foreground">
              Conecta un dispositivo MikroTik desde Configuración
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scan Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Escanear Clientes MikroTik
          </CardTitle>
          <CardDescription>
            Escanea PPPoE secrets y Simple Queues para importar clientes que no están registrados en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="scanType">Tipo de escaneo</Label>
              <Select value={scanType} onValueChange={(v) => setScanType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Todos (PPPoE + Queues)
                    </div>
                  </SelectItem>
                  <SelectItem value="pppoe">
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4" />
                      Solo PPPoE
                    </div>
                  </SelectItem>
                  <SelectItem value="queue">
                    <div className="flex items-center gap-2">
                      <Network className="h-4 w-4" />
                      Solo Simple Queues
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button 
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
                className="w-full sm:w-auto"
              >
                {scanMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Escaneando...
                  </>
                ) : (
                  <>
                    <Scan className="h-4 w-4 mr-2" />
                    Escanear
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scan Results */}
      {scanResult && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Resultados del Escaneo</CardTitle>
                <CardDescription className="flex items-center gap-4 mt-2">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    Total: {scanResult.total}
                  </span>
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Registrados: {scanResult.registered}
                  </span>
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertCircle className="h-4 w-4" />
                    Sin registrar: {scanResult.unregistered.length}
                  </span>
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportSelected}
                  disabled={selectedClients.size === 0 || importMutation.isPending}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Importar seleccionados ({selectedClients.size})
                </Button>
                <Button
                  size="sm"
                  onClick={handleImportAll}
                  disabled={scanResult.unregistered.length === 0 || importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Importar todos
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {scanResult.unregistered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <p className="font-medium">¡Todos los clientes están registrados!</p>
                <p className="text-sm">No hay clientes pendientes de importar</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <Input
                    placeholder="Buscar por nombre, IP o comentario..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-md"
                  />
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={filteredClients.length > 0 && selectedClients.size === filteredClients.length}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Perfil/Velocidad</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Comentario</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredClients.map((client) => {
                        const key = `${client.name}-${client.ip}`;
                        return (
                          <TableRow key={key}>
                            <TableCell>
                              <Checkbox
                                checked={selectedClients.has(key)}
                                onCheckedChange={() => toggleClient(client)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{client.name}</TableCell>
                            <TableCell className="font-mono text-sm">{client.ip}</TableCell>
                            <TableCell>
                              <Badge variant={client.type === 'pppoe' ? 'default' : 'secondary'}>
                                {client.type === 'pppoe' ? (
                                  <><Wifi className="h-3 w-3 mr-1" />PPPoE</>
                                ) : (
                                  <><Network className="h-3 w-3 mr-1" />Queue</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>{client.profile || client.speed || '-'}</TableCell>
                            <TableCell>
                              {client.disabled ? (
                                <Badge variant="destructive" className="text-xs">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Deshabilitado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Activo
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                              {client.comment || '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <AlertCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Sistema de Suspensión Automática</p>
              <p className="text-muted-foreground">
                Los clientes importados quedarán vinculados a su IP asignada. Cuando una factura venza 
                y el cliente no pague, el sistema agregará automáticamente su IP al address-list 
                <code className="mx-1 px-1 py-0.5 bg-muted rounded">{getSuspensionAddressList()}</code>.
              </p>
              <p className="text-muted-foreground">
                Cuando el cliente pague, se eliminará automáticamente del address-list, 
                restaurando su servicio.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
