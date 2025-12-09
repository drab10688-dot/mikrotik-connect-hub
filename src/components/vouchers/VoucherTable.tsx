import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Trash2, Search, Printer, QrCode, Clock } from 'lucide-react';

interface VoucherTableProps {
  vouchers: any[];
  onDelete: (voucherId: string) => void;
  onPrint: (voucher: any) => void;
  onViewQR: (voucher: any) => void;
  selectedVouchers: string[];
  onSelectVoucher: (voucherId: string) => void;
  onSelectAll: (all: boolean) => void;
}

// Parse uptime string to seconds
function parseUptimeToSeconds(uptime: string): number {
  if (!uptime || uptime === '0s') return 0;
  
  let totalSeconds = 0;
  const weekMatch = uptime.match(/(\d+)w/);
  const dayMatch = uptime.match(/(\d+)d/);
  const hourMatch = uptime.match(/(\d+)h/);
  const minMatch = uptime.match(/(\d+)m(?!s)/);
  const secMatch = uptime.match(/(\d+)s/);

  if (weekMatch) totalSeconds += parseInt(weekMatch[1]) * 7 * 24 * 60 * 60;
  if (dayMatch) totalSeconds += parseInt(dayMatch[1]) * 24 * 60 * 60;
  if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 60 * 60;
  if (minMatch) totalSeconds += parseInt(minMatch[1]) * 60;
  if (secMatch) totalSeconds += parseInt(secMatch[1]);

  return totalSeconds;
}

// Parse validity string to seconds
function parseValidityToSeconds(validity: string): number {
  if (!validity) return 0;
  
  const hourMatch = validity.match(/^(\d+)h$/);
  const dayMatch = validity.match(/^(\d+)d$/);
  const weekMatch = validity.match(/^(\d+)w$/);
  const monthMatch = validity.match(/^(\d+)m$/);

  if (hourMatch) return parseInt(hourMatch[1]) * 60 * 60;
  if (dayMatch) return parseInt(dayMatch[1]) * 24 * 60 * 60;
  if (weekMatch) return parseInt(weekMatch[1]) * 7 * 24 * 60 * 60;
  if (monthMatch) return parseInt(monthMatch[1]) * 30 * 24 * 60 * 60;

  return 0;
}

// Format seconds to readable time
function formatTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

export const VoucherTable = ({ 
  vouchers, 
  onDelete, 
  onPrint,
  onViewQR,
  selectedVouchers,
  onSelectVoucher,
  onSelectAll,
}: VoucherTableProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [, forceUpdate] = useState(0);

  // Force re-render every second to update remaining time
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredVouchers = vouchers?.filter(voucher =>
    voucher.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    voucher.profile.toLowerCase().includes(searchTerm.toLowerCase()) ||
    voucher.status.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string; className?: string }> = {
      available: { variant: 'default', label: 'Disponible' },
      sold: { variant: 'secondary', label: 'Vendido' },
      used: { variant: 'outline', label: 'En Uso', className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
      expired: { variant: 'destructive', label: 'Expirado' },
    };
    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };

  const getRemainingTime = (voucher: any) => {
    if (!voucher.validity || voucher.status === 'available' || voucher.status === 'sold') {
      return null;
    }

    const validitySeconds = parseValidityToSeconds(voucher.validity);
    const uptimeSeconds = parseUptimeToSeconds(voucher.uptime || '0s');
    const remainingSeconds = validitySeconds - uptimeSeconds;

    if (remainingSeconds <= 0) {
      return { remaining: 0, percentage: 100, formatted: 'Expirado' };
    }

    const percentage = (uptimeSeconds / validitySeconds) * 100;
    return {
      remaining: remainingSeconds,
      percentage: Math.min(percentage, 100),
      formatted: formatTime(remainingSeconds),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, perfil o estado..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {filteredVouchers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No se encontraron vouchers
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedVouchers.length === filteredVouchers.length && filteredVouchers.length > 0}
                    onCheckedChange={(checked) => onSelectAll(!!checked)}
                  />
                </TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Contraseña</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Tiempo Restante</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVouchers.map((voucher) => {
                const timeInfo = getRemainingTime(voucher);
                const isActive = voucher.status === 'used' && timeInfo && timeInfo.remaining > 0;
                
                return (
                  <TableRow key={voucher.id} className={isActive ? 'bg-green-50/50 dark:bg-green-900/10' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selectedVouchers.includes(voucher.id)}
                        onCheckedChange={() => onSelectVoucher(voucher.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono font-bold">{voucher.code}</TableCell>
                    <TableCell className="font-mono">{voucher.password}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{voucher.profile}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(voucher.status)}</TableCell>
                    <TableCell>
                      {timeInfo ? (
                        <div className="space-y-1 min-w-[120px]">
                          <div className="flex items-center gap-2">
                            <Clock className={`h-3 w-3 ${timeInfo.remaining <= 300 ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`} />
                            <span className={`text-sm font-mono font-medium ${timeInfo.remaining <= 300 ? 'text-destructive' : ''}`}>
                              {timeInfo.formatted}
                            </span>
                          </div>
                          <Progress 
                            value={100 - timeInfo.percentage} 
                            className="h-1.5"
                          />
                          <div className="text-xs text-muted-foreground">
                            Usado: {voucher.uptime || '0s'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {voucher.validity || '-'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {voucher.price ? `$${voucher.price.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewQR(voucher)}
                          title="Ver QR"
                        >
                          <QrCode className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPrint(voucher)}
                          title="Imprimir"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`¿Eliminar voucher ${voucher.code}?`)) {
                              onDelete(voucher.id);
                            }
                          }}
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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
    </div>
  );
};
