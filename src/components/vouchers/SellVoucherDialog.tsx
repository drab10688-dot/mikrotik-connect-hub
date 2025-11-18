import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart } from 'lucide-react';

interface SellVoucherDialogProps {
  voucher: any;
  onSell: (voucherId: string, price: number) => void;
  isSelling: boolean;
}

export const SellVoucherDialog = ({ voucher, onSell, isSelling }: SellVoucherDialogProps) => {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(voucher.price || 0);

  const handleSell = () => {
    onSell(voucher.id, price);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShoppingCart className="h-4 w-4 mr-2" />
          Vender
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vender Voucher</DialogTitle>
          <DialogDescription>
            Registra la venta de este voucher
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Código:</span>
              <span className="font-mono font-bold">{voucher.code}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Contraseña:</span>
              <span className="font-mono">{voucher.password}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Perfil:</span>
              <Badge variant="outline">{voucher.profile}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Expira:</span>
              <span className="text-sm">
                {new Date(voucher.expires_at).toLocaleDateString('es-ES')}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Precio de Venta</Label>
            <Input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSell} disabled={isSelling}>
            {isSelling ? 'Registrando...' : 'Confirmar Venta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
