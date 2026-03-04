import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Trash2, Search, Printer, QrCode, Clock, CalendarIcon, X } from 'lucide-react';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, isSameDay, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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
  const [dateFilter, setDateFilter] = useState<'all' | 'day' | 'month' | 'year' | 'custom'>('all');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [, forceUpdate] = useState(0);

  // Force re-render every second to update remaining time
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getDateRange = () => {
    switch (dateFilter) {
      case 'day':
        return { start: startOfDay(selectedDate), end: endOfDay(selectedDate) };
      case 'month':
        return { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) };
      case 'year':
        return { start: startOfYear(selectedDate), end: endOfYear(selectedDate) };
      default:
        return null;
    }
  };

  const filteredVouchers = vouchers?.filter(voucher => {
    // Text search filter
    const matchesSearch = 
      voucher.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      voucher.profile.toLowerCase().includes(searchTerm.toLowerCase()) ||
      voucher.status.toLowerCase().includes(searchTerm.toLowerCase());

    // Date filter
    const dateRange = getDateRange();
    if (!dateRange) return matchesSearch;

    const voucherDate = new Date(voucher.created_at);
    const matchesDate = isWithinInterval(voucherDate, { start: dateRange.start, end: dateRange.end });

    return matchesSearch && matchesDate;
  }) || [];

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

  const getDateFilterLabel = () => {
    switch (dateFilter) {
      case 'day':
        return format(selectedDate, "dd 'de' MMMM, yyyy", { locale: es });
      case 'month':
        return format(selectedDate, "MMMM yyyy", { locale: es });
      case 'year':
        return format(selectedDate, "yyyy", { locale: es });
      default:
        return 'Todos';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, perfil o estado..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="day">Por Día</SelectItem>
              <SelectItem value="month">Por Mes</SelectItem>
              <SelectItem value="year">Por Año</SelectItem>
            </SelectContent>
          </Select>

          {dateFilter !== 'all' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">{getDateFilterLabel()}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  locale={es}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          )}

          {dateFilter !== 'all' && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setDateFilter('all')}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {dateFilter !== 'all' && (
        <div className="text-sm text-muted-foreground">
          Mostrando vouchers de: <span className="font-medium text-foreground">{getDateFilterLabel()}</span>
          {' '}({filteredVouchers.length} resultados)
        </div>
      )}

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
