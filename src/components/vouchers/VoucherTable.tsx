import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SellVoucherDialog } from './SellVoucherDialog';
import { Trash2, Search, Printer, QrCode } from 'lucide-react';

interface VoucherTableProps {
  vouchers: any[];
  onSell: (voucherId: string, price: number) => void;
  onDelete: (voucherId: string) => void;
  onPrint: (voucher: any) => void;
  onViewQR: (voucher: any) => void;
  isSelling: boolean;
  selectedVouchers: string[];
  onSelectVoucher: (voucherId: string) => void;
  onSelectAll: (all: boolean) => void;
}

export const VoucherTable = ({ 
  vouchers, 
  onSell, 
  onDelete, 
  onPrint,
  onViewQR,
  isSelling,
  selectedVouchers,
  onSelectVoucher,
  onSelectAll,
}: VoucherTableProps) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredVouchers = vouchers?.filter(voucher =>
    voucher.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    voucher.profile.toLowerCase().includes(searchTerm.toLowerCase()) ||
    voucher.status.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      available: { variant: 'default', label: 'Disponible' },
      sold: { variant: 'secondary', label: 'Vendido' },
      used: { variant: 'outline', label: 'Usado' },
      expired: { variant: 'destructive', label: 'Expirado' },
    };
    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
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
        <div className="border rounded-lg">
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
                <TableHead>Precio</TableHead>
                <TableHead>Expira</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVouchers.map((voucher) => (
                <TableRow key={voucher.id}>
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
                    {voucher.price ? `$${voucher.price.toFixed(2)}` : '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(voucher.expires_at).toLocaleDateString('es-ES')}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {voucher.status === 'available' && (
                        <SellVoucherDialog
                          voucher={voucher}
                          onSell={onSell}
                          isSelling={isSelling}
                        />
                      )}
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
