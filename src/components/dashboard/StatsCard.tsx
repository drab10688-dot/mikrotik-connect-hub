import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  gradient: string;
}

export const StatsCard = ({ title, value, icon: Icon, trend, gradient }: StatsCardProps) => {
  return (
    <Card className="overflow-hidden border-border/50 hover:shadow-md transition-shadow">
      <CardContent className="p-0">
        <div className={`bg-${gradient} p-6 text-white`}>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium opacity-90">{title}</p>
              <p className="text-3xl font-bold">{value}</p>
              {trend && <p className="text-sm opacity-75">{trend}</p>}
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <Icon className="w-6 h-6" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
