import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Signal } from "lucide-react";

const Ppp = () => {
  const pppConnections = [
    { name: "pppoe-user1", service: "pppoe", caller: "00:11:22:33:44:55", address: "10.10.10.2", uptime: "1d 12h", status: "active" },
    { name: "pppoe-user2", service: "pppoe", caller: "00:11:22:33:44:56", address: "10.10.10.3", uptime: "2h 45m", status: "active" },
    { name: "pptp-remote1", service: "pptp", caller: "192.168.1.100", address: "10.10.10.10", uptime: "0h 15m", status: "active" },
    { name: "l2tp-user1", service: "l2tp", caller: "192.168.1.101", address: "", uptime: "", status: "disabled" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Gestión PPP</h1>
          <p className="text-muted-foreground">Administra conexiones PPPoE, PPTP y L2TP</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Conexiones PPP</CardTitle>
                <CardDescription>Estado de todas las conexiones punto a punto</CardDescription>
              </div>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nueva Conexión
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {pppConnections.map((conn, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      conn.status === "active" ? "bg-success/10" : "bg-muted"
                    }`}>
                      <Signal className={`w-6 h-6 ${
                        conn.status === "active" ? "text-success" : "text-muted-foreground"
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-medium">{conn.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {conn.caller} → {conn.address || "Sin asignar"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <Badge variant="outline" className="mb-1">
                        {conn.service.toUpperCase()}
                      </Badge>
                      {conn.uptime && (
                        <p className="text-sm text-muted-foreground">Uptime: {conn.uptime}</p>
                      )}
                    </div>
                    {conn.status === "active" ? (
                      <Badge className="bg-success/10 text-success border-success/20">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Deshabilitado</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Ppp;
