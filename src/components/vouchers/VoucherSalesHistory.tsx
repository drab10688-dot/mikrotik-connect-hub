import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, History, DollarSign, Download } from 'lucide-react';
import { useVoucherSalesHistory, VoucherSaleRecord } from '@/hooks/useVoucherSalesHistory';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface VoucherSalesHistoryProps {
  mikrotikId: string;
}

export const VoucherSalesHistory = ({ mikrotikId }: VoucherSalesHistoryProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const { salesHistory, isLoading, stats } = useVoucherSalesHistory(mikrotikId);

  const filteredHistory = salesHistory?.filter(record =>
    record.voucher_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.profile.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleExportCSV = () => {
    if (!filteredHistory.length) return;

    const headers = ['Código', 'Perfil', 'Validez', 'Precio', 'Vendido', 'Tiempo Usado', 'Expirado'];
    const rows = filteredHistory.map(record => [
      record.voucher_code,
      record.profile,
      record.validity,
      record.price?.toFixed(2) || '0',
      record.sold_at ? format(new Date(record.sold_at), 'dd/MM/yyyy HH:mm', { locale: es }) : '-',
      record.total_uptime || '-',
      format(new Date(record.expired_at), 'dd/MM/yyyy HH:mm', { locale: es }),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `historial-ventas-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial de Ventas Completadas
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="font-semibold">${stats.revenue.toFixed(2)}</span>
              <span className="text-muted-foreground">Total</span>
            </div>
            <Badge variant="secondary">{stats.total} registros</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código o perfil..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!filteredHistory.length}>
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando historial...</div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hay registros de ventas completadas
          </div>
        ) : (
          <div className="border rounded-lg max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Validez</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Vendido</TableHead>
                  <TableHead>Tiempo Usado</TableHead>
                  <TableHead>Expirado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono font-bold">{record.voucher_code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{record.profile}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{record.validity}</TableCell>
                    <TableCell className="font-semibold text-green-600">
                      ${record.price?.toFixed(2) || '0.00'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {record.sold_at 
                        ? format(new Date(record.sold_at), 'dd/MM/yy HH:mm', { locale: es })
                        : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {record.total_uptime || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(record.expired_at), 'dd/MM/yy HH:mm', { locale: es })}
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
};
