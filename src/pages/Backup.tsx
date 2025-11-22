import { Sidebar } from "@/components/dashboard/Sidebar";
import { BackupRestoreCard } from "@/components/settings/BackupRestoreCard";

export default function Backup() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Backup y Restore</h1>
            <p className="text-muted-foreground">
              Exporta e importa configuraciones del MikroTik
            </p>
          </div>

          <BackupRestoreCard />
        </div>
      </div>
    </div>
  );
}
