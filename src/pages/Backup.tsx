import { Sidebar } from "@/components/dashboard/Sidebar";
import { BackupRestoreCard } from "@/components/settings/BackupRestoreCard";
import { VpsBackupManager } from "@/components/settings/VpsBackupManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Router } from "lucide-react";

export default function Backup() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Backup y Restore</h1>
            <p className="text-muted-foreground">
              Gestiona backups del servidor VPS y configuración MikroTik
            </p>
          </div>

          <Tabs defaultValue="vps" className="space-y-4">
            <TabsList>
              <TabsTrigger value="vps" className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                Servidor VPS
              </TabsTrigger>
              <TabsTrigger value="mikrotik" className="flex items-center gap-2">
                <Router className="h-4 w-4" />
                MikroTik
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vps">
              <VpsBackupManager />
            </TabsContent>

            <TabsContent value="mikrotik">
              <BackupRestoreCard />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
