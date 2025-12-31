import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { History, Wifi, Gauge, MapPin, Phone, Mail } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function ClientHistoryTable() {
  const mikrotikId = getSelectedDeviceId();

  const { data: clients, isLoading } = useQuery({
    queryKey: ["isp-clients", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from("isp_clients")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  if (!mikrotikId) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <History className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Historial de Clientes Registrados</CardTitle>
            <CardDescription>Últimos 50 clientes registrados en este dispositivo</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-2">Cargando historial...</p>
          </div>
        ) : !clients || clients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hay clientes registrados aún
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Plan/Velocidad</TableHead>
                  <TableHead>Contacto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client: any) => (
                  <TableRow key={client.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(client.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{client.client_name}</div>
                      {client.identification_number && (
                        <div className="text-xs text-muted-foreground">ID: {client.identification_number}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.connection_type === 'pppoe' ? (
                        <Badge variant="default" className="gap-1">
                          <Wifi className="h-3 w-3" />
                          PPPoE
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-200">
                          <Gauge className="h-3 w-3" />
                          Queue
                        </Badge>
                      )}
                      {client.is_potential_client && (
                        <Badge variant="outline" className="ml-1 text-xs">Potencial</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{client.username}</TableCell>
                    <TableCell className="font-mono text-sm">{client.assigned_ip || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{client.plan_or_speed || "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        {client.phone && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {client.phone}
                          </div>
                        )}
                        {client.email && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {client.email}
                          </div>
                        )}
                        {client.city && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {client.city}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
