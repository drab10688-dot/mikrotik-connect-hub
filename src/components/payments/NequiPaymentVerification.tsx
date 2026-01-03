import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { 
  Loader2, 
  CheckCircle, 
  AlertTriangle, 
  Search,
  ShieldCheck,
  Ban,
  QrCode,
  Camera,
  X,
  Upload,
  ImageIcon
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

interface NequiPaymentVerificationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    client_id: string | null;
    mikrotik_id: string;
  } | null;
  onPaymentVerified?: () => void;
}

interface VerificationResult {
  isValid: boolean;
  isDuplicate: boolean;
  existingInvoice?: string;
  existingDate?: string;
}

export function NequiPaymentVerification({
  open,
  onOpenChange,
  invoice,
  onPaymentVerified
}: NequiPaymentVerificationProps) {
  const queryClient = useQueryClient();
  const [nequiReference, setNequiReference] = useState("");
  const [extractedAmount, setExtractedAmount] = useState<number | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isExtractingFromImage, setIsExtractingFromImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "nequi-qr-scanner";

  // Check if reference already exists in database
  const checkDuplicateReference = async (reference: string): Promise<VerificationResult> => {
    // Check in client_invoices
    const { data: existingInvoice, error: invoiceError } = await supabase
      .from('client_invoices')
      .select('id, invoice_number, paid_at')
      .eq('payment_reference', reference)
      .maybeSingle();

    if (invoiceError) {
      console.error('Error checking invoice reference:', invoiceError);
    }

    if (existingInvoice) {
      return {
        isValid: false,
        isDuplicate: true,
        existingInvoice: existingInvoice.invoice_number,
        existingDate: existingInvoice.paid_at || undefined
      };
    }

    // Check in payment_transactions
    const { data: existingTransaction, error: txError } = await supabase
      .from('payment_transactions')
      .select('id, invoice_id, created_at, status')
      .or(`transaction_id.eq.${reference},external_reference.eq.${reference}`)
      .eq('status', 'approved')
      .maybeSingle();

    if (txError) {
      console.error('Error checking transaction reference:', txError);
    }

    if (existingTransaction) {
      // Get invoice number if exists
      let invoiceNumber = 'Desconocida';
      if (existingTransaction.invoice_id) {
        const { data: inv } = await supabase
          .from('client_invoices')
          .select('invoice_number')
          .eq('id', existingTransaction.invoice_id)
          .single();
        if (inv) invoiceNumber = inv.invoice_number;
      }

      return {
        isValid: false,
        isDuplicate: true,
        existingInvoice: invoiceNumber,
        existingDate: existingTransaction.created_at
      };
    }

    return { isValid: true, isDuplicate: false };
  };

  // Verify reference mutation
  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!nequiReference.trim()) {
        throw new Error('Ingresa la referencia de pago Nequi');
      }

      const cleanReference = nequiReference.trim().toUpperCase();
      
      // Validate reference format (Nequi references are typically alphanumeric, 10-20 chars)
      if (cleanReference.length < 6) {
        throw new Error('La referencia Nequi parece ser muy corta. Verifica el número.');
      }

      setIsVerifying(true);
      const result = await checkDuplicateReference(cleanReference);
      setVerificationResult(result);
      setIsVerifying(false);

      return result;
    },
    onError: (error: any) => {
      setIsVerifying(false);
      toast.error(error.message);
    }
  });

  // Confirm payment mutation
  const confirmPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!invoice || !nequiReference.trim()) {
        throw new Error('Datos incompletos');
      }

      if (!verificationResult?.isValid) {
        throw new Error('La referencia no ha sido verificada o ya está en uso');
      }

      const cleanReference = nequiReference.trim().toUpperCase();

      // Update invoice as paid
      const { error: invoiceError } = await supabase
        .from('client_invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          paid_via: 'nequi_manual',
          payment_reference: cleanReference
        })
        .eq('id', invoice.id);

      if (invoiceError) throw invoiceError;

      // Create transaction record
      const { error: txError } = await supabase
        .from('payment_transactions')
        .insert({
          invoice_id: invoice.id,
          mikrotik_id: invoice.mikrotik_id,
          amount: invoice.amount,
          platform: 'nequi',
          status: 'approved',
          transaction_id: cleanReference,
          external_reference: cleanReference,
          currency: 'COP'
        });

      if (txError) {
        console.warn('Error creating transaction record:', txError);
        // Don't throw - invoice is already marked as paid
      }

      // Reactivate client if suspended
      const { data: billingSetting } = await supabase
        .from('client_billing_settings')
        .select('id, is_suspended')
        .eq('client_id', invoice.client_id)
        .maybeSingle();

      if (billingSetting?.is_suspended) {
        await supabase
          .from('client_billing_settings')
          .update({
            is_suspended: false,
            suspended_at: null,
            last_payment_date: new Date().toISOString().split('T')[0]
          })
          .eq('id', billingSetting.id);
      }

      return true;
    },
    onSuccess: () => {
      toast.success('Pago Nequi verificado y registrado correctamente');
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      handleClose();
      onPaymentVerified?.();
    },
    onError: (error: any) => {
      toast.error(`Error al registrar pago: ${error.message}`);
    }
  });

  const handleClose = () => {
    stopScanner();
    setNequiReference("");
    setExtractedAmount(null);
    setVerificationResult(null);
    setIsVerifying(false);
    setShowScanner(false);
    setScannerError(null);
    setIsExtractingFromImage(false);
    onOpenChange(false);
  };

  // Image upload and extraction
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Por favor selecciona una imagen válida");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen es muy grande. Máximo 5MB.");
      return;
    }

    setIsExtractingFromImage(true);
    setVerificationResult(null);

    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Call edge function to extract data
      const { data, error } = await supabase.functions.invoke("extract-nequi-receipt", {
        body: { imageBase64: base64 }
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
        return;
      }

      // Set extracted values
      if (data.reference) {
        setNequiReference(data.reference);
        toast.success("¡Referencia extraída correctamente!");
      }

      if (data.amount && typeof data.amount === "number") {
        setExtractedAmount(data.amount);
        
        // Check if amount matches invoice
        if (invoice && data.amount !== invoice.amount) {
          toast.warning(
            `El monto extraído ($${data.amount.toLocaleString()}) no coincide con la factura ($${invoice.amount.toLocaleString()})`,
            { duration: 5000 }
          );
        } else if (invoice && data.amount === invoice.amount) {
          toast.success("¡El monto coincide con la factura!");
        }
      }

      if (!data.reference && !data.amount) {
        toast.warning("No se pudo extraer información del comprobante. Intenta con otra imagen.");
      }

    } catch (error: any) {
      console.error("Error extracting from image:", error);
      toast.error("Error al procesar la imagen. Intenta de nuevo.");
    } finally {
      setIsExtractingFromImage(false);
    }
  };

  // QR Scanner functions
  const startScanner = async () => {
    setScannerError(null);
    setShowScanner(true);

    // Small delay to ensure the container is rendered
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      scannerRef.current = new Html5Qrcode(scannerContainerId);
      
      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // Extract reference from QR - Nequi QRs usually contain payment info
          const reference = extractNequiReference(decodedText);
          if (reference) {
            setNequiReference(reference);
            toast.success("¡QR escaneado exitosamente!");
            stopScanner();
          } else {
            // Still use the raw text if no pattern matches
            setNequiReference(decodedText);
            toast.info("QR leído. Verifica que sea la referencia correcta.");
            stopScanner();
          }
        },
        () => {
          // Ignore QR errors - just means no QR found yet
        }
      );
    } catch (err: any) {
      console.error("Scanner error:", err);
      if (err.toString().includes("NotAllowedError")) {
        setScannerError("Permiso de cámara denegado. Por favor, permite el acceso a la cámara.");
      } else if (err.toString().includes("NotFoundError")) {
        setScannerError("No se encontró cámara en este dispositivo.");
      } else {
        setScannerError("Error al iniciar la cámara. Intenta de nuevo.");
      }
      setShowScanner(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current?.isScanning) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
    }
    scannerRef.current = null;
    setShowScanner(false);
  };

  const extractNequiReference = (qrContent: string): string | null => {
    // Try to extract reference from common Nequi QR formats
    // Format 1: Direct reference number
    const refMatch = qrContent.match(/NQ\d+/i);
    if (refMatch) return refMatch[0].toUpperCase();

    // Format 2: URL with reference parameter
    const urlRefMatch = qrContent.match(/[?&]ref(?:erence)?=([^&]+)/i);
    if (urlRefMatch) return urlRefMatch[1].toUpperCase();

    // Format 3: JSON format
    try {
      const json = JSON.parse(qrContent);
      if (json.reference) return json.reference.toUpperCase();
      if (json.ref) return json.ref.toUpperCase();
      if (json.transactionId) return json.transactionId.toUpperCase();
    } catch {
      // Not JSON, continue
    }

    // Format 4: If it's a clean alphanumeric string (likely a reference)
    const cleanContent = qrContent.trim();
    if (/^[A-Za-z0-9]{6,30}$/.test(cleanContent)) {
      return cleanContent.toUpperCase();
    }

    return null;
  };

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const handleVerify = () => {
    verifyMutation.mutate();
  };

  const handleConfirmPayment = () => {
    confirmPaymentMutation.mutate();
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-purple-600" />
            Verificar Pago Nequi
          </DialogTitle>
          <DialogDescription>
            Factura: {invoice.invoice_number} - ${invoice.amount.toLocaleString()} COP
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* QR Scanner Section */}
          {showScanner ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" />
                  Escaneando QR...
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={stopScanner}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancelar
                </Button>
              </div>
              <div 
                id={scannerContainerId} 
                className="w-full aspect-square rounded-lg overflow-hidden bg-muted"
              />
              <p className="text-xs text-muted-foreground text-center">
                Apunta la cámara al código QR del comprobante Nequi
              </p>
            </div>
          ) : (
            <>
              {/* Image upload for extracting data */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Subir comprobante Nequi
                </Label>
                <div className="flex gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isExtractingFromImage || confirmPaymentMutation.isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isExtractingFromImage || confirmPaymentMutation.isPending}
                  >
                    {isExtractingFromImage ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Analizando imagen...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Subir imagen del comprobante
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  La IA extraerá automáticamente la referencia y el monto del comprobante.
                </p>
              </div>

              {/* Extracted amount display */}
              {extractedAmount !== null && (
                <Alert className={extractedAmount === invoice?.amount 
                  ? "border-green-500 bg-green-50 dark:bg-green-950" 
                  : "border-yellow-500 bg-yellow-50 dark:bg-yellow-950"
                }>
                  <CheckCircle className={`h-4 w-4 ${extractedAmount === invoice?.amount ? "text-green-600" : "text-yellow-600"}`} />
                  <AlertDescription>
                    <strong>Monto extraído:</strong> ${extractedAmount.toLocaleString()} COP
                    {invoice && extractedAmount !== invoice.amount && (
                      <span className="block text-yellow-700 dark:text-yellow-300 text-sm mt-1">
                        ⚠️ No coincide con la factura (${invoice.amount.toLocaleString()} COP)
                      </span>
                    )}
                    {invoice && extractedAmount === invoice.amount && (
                      <span className="block text-green-700 dark:text-green-300 text-sm mt-1">
                        ✓ Coincide con el valor de la factura
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Scanner Error */}
              {scannerError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{scannerError}</AlertDescription>
                </Alert>
              )}

              {/* Reference Input */}
              <div className="space-y-2">
                <Label htmlFor="nequi-ref">Referencia de Pago Nequi</Label>
                <div className="flex gap-2">
                  <Input
                    id="nequi-ref"
                    value={nequiReference}
                    onChange={(e) => {
                      setNequiReference(e.target.value);
                      setVerificationResult(null);
                    }}
                    placeholder="Ej: NQ123456789"
                    className="flex-1"
                    disabled={confirmPaymentMutation.isPending || isExtractingFromImage}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={startScanner}
                    disabled={confirmPaymentMutation.isPending || isExtractingFromImage}
                    title="Escanear QR"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVerify}
                    disabled={!nequiReference.trim() || isVerifying || confirmPaymentMutation.isPending || isExtractingFromImage}
                  >
                    {isVerifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Escanea el QR, sube una imagen o ingresa la referencia manualmente.
                </p>
              </div>
            </>
          )}

          {/* Verification Result */}
          {verificationResult && (
            <div className="space-y-3">
              {verificationResult.isValid ? (
                <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700 dark:text-green-300">
                    <strong>Referencia válida.</strong> Esta referencia no ha sido utilizada anteriormente. 
                    Puedes confirmar el pago.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <Ban className="h-4 w-4" />
                  <AlertDescription>
                    <strong>¡Referencia duplicada!</strong>
                    <br />
                    Esta referencia ya fue usada para la factura: <strong>{verificationResult.existingInvoice}</strong>
                    {verificationResult.existingDate && (
                      <> el {new Date(verificationResult.existingDate).toLocaleDateString('es-CO')}</>
                    )}
                    <br />
                    <span className="text-sm mt-1 block">
                      Solicita al cliente un comprobante diferente o verifica que no sea intento de fraude.
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Warning for manual verification */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Importante:</strong> Verifica que el monto del pago Nequi coincida con el valor de la factura 
              (${invoice.amount.toLocaleString()} COP) antes de confirmar.
            </AlertDescription>
          </Alert>

          {/* Confirm Button */}
          <Button
            className="w-full bg-purple-600 hover:bg-purple-700"
            onClick={handleConfirmPayment}
            disabled={
              !verificationResult?.isValid || 
              confirmPaymentMutation.isPending
            }
          >
            {confirmPaymentMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Confirmar Pago Verificado
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
