import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Edit, Trash2, Wifi, Cable } from "lucide-react";
import { useHotspotProfiles, usePPPoEProfiles } from "@/hooks/useMikrotikData";
import { toast } from "sonner";
import { deleteHotspotProfile, deletePPPoEProfile } from "@/lib/mikrotik";
import { AddHotspotProfileDialog } from "@/components/forms/AddHotspotProfileDialog";
import { AddPPPoEProfileDialog } from "@/components/forms/AddPPPoEProfileDialog";

export default function Profiles() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: hotspotProfiles, isLoading: loadingHotspot, refetch: refetchHotspot } = useHotspotProfiles();
  const { data: pppoeProfiles, isLoading: loadingPPPoE, refetch: refetchPPPoE } = usePPPoEProfiles();

  const handleDeleteHotspotProfile = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar el perfil "${name}"?`)) return;
    
    try {
      await deleteHotspotProfile(id);
      toast.success("Perfil Hotspot eliminado");
      refetchHotspot();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar perfil");
    }
  };

  const handleDeletePPPoEProfile = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar el perfil "${name}"?`)) return;
    
    try {
      await deletePPPoEProfile(id);
      toast.success("Perfil PPPoE eliminado");
      refetchPPPoE();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar perfil");
    }
  };

  const filteredHotspotProfiles = hotspotProfiles?.filter((profile: any) =>
    profile.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPPPoEProfiles = pppoeProfiles?.filter((profile: any) =>
    profile.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Perfiles</h1>
          <p className="text-muted-foreground">Configura límites de velocidad, tiempo de sesión y cuotas de datos</p>
        </div>
      </div>

      <Tabs defaultValue="hotspot" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hotspot" className="flex items-center gap-2">
            <Wifi className="w-4 h-4" />
            Perfiles Hotspot
          </TabsTrigger>
          <TabsTrigger value="pppoe" className="flex items-center gap-2">
            <Cable className="w-4 h-4" />
            Perfiles PPPoE
          </TabsTrigger>
        </TabsList>

        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar perfiles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <TabsContent value="hotspot" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Perfiles Hotspot</CardTitle>
                  <CardDescription>Gestiona perfiles para usuarios de Hotspot</CardDescription>
                </div>
                <AddHotspotProfileDialog onSuccess={refetchHotspot} />
              </div>
            </CardHeader>
            <CardContent>
              {loadingHotspot ? (
                <div className="text-center py-8 text-muted-foreground">Cargando perfiles...</div>
              ) : filteredHotspotProfiles?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No se encontraron perfiles</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Límite de Velocidad</TableHead>
                      <TableHead>Tiempo de Sesión</TableHead>
                      <TableHead>Tiempo Inactivo</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHotspotProfiles?.map((profile: any) => (
                      <TableRow key={profile[".id"]}>
                        <TableCell className="font-medium">{profile.name}</TableCell>
                        <TableCell>
                          {profile["rate-limit"] ? (
                            <Badge variant="secondary">{profile["rate-limit"]}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Sin límite</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {profile["session-timeout"] || <span className="text-muted-foreground">Ilimitado</span>}
                        </TableCell>
                        <TableCell>
                          {profile["idle-timeout"] || <span className="text-muted-foreground">Sin límite</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteHotspotProfile(profile[".id"], profile.name)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pppoe" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Perfiles PPPoE</CardTitle>
                  <CardDescription>Gestiona perfiles para conexiones PPPoE</CardDescription>
                </div>
                <AddPPPoEProfileDialog onSuccess={refetchPPPoE} />
              </div>
            </CardHeader>
            <CardContent>
              {loadingPPPoE ? (
                <div className="text-center py-8 text-muted-foreground">Cargando perfiles...</div>
              ) : filteredPPPoEProfiles?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No se encontraron perfiles</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Límite de Velocidad</TableHead>
                      <TableHead>Dirección Local</TableHead>
                      <TableHead>Pool Remoto</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPPPoEProfiles?.map((profile: any) => (
                      <TableRow key={profile[".id"]}>
                        <TableCell className="font-medium">{profile.name}</TableCell>
                        <TableCell>
                          {profile["rate-limit"] ? (
                            <Badge variant="secondary">{profile["rate-limit"]}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Sin límite</span>
                          )}
                        </TableCell>
                        <TableCell>{profile["local-address"] || "-"}</TableCell>
                        <TableCell>{profile["remote-address"] || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeletePPPoEProfile(profile[".id"], profile.name)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
