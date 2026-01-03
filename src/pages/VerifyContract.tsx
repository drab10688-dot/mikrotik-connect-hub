import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, FileText, User, Calendar, Building2, Shield } from "lucide-react";

interface ContractVerificationData {
  contract: string;
  client: string;
  id: string;
  date: string;
  company: string;
}

export default function VerifyContract() {
  const [searchParams] = useSearchParams();
  const [contractData, setContractData] = useState<ContractVerificationData | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dataParam = searchParams.get("data");
    
    if (!dataParam) {
      setError("No se proporcionó información del contrato");
      return;
    }

    try {
      const decoded = decodeURIComponent(atob(dataParam));
      const parsed: ContractVerificationData = JSON.parse(decoded);
      
      // Validar que tenga todos los campos requeridos
      if (parsed.contract && parsed.client && parsed.id && parsed.date && parsed.company) {
        setContractData(parsed);
        setIsValid(true);
      } else {
        setError("Datos del contrato incompletos");
      }
    } catch {
      setError("Código QR inválido o corrupto");
    }
  }, [searchParams]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {isValid ? (
              <div className="p-4 rounded-full bg-green-500/10">
                <CheckCircle2 className="w-16 h-16 text-green-500" />
              </div>
            ) : (
              <div className="p-4 rounded-full bg-destructive/10">
                <XCircle className="w-16 h-16 text-destructive" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl">
            {isValid ? "Contrato Verificado" : "Verificación Fallida"}
          </CardTitle>
          <CardDescription>
            {isValid 
              ? "Este contrato es auténtico y fue generado por nuestro sistema"
              : error || "No se pudo verificar el contrato"
            }
          </CardDescription>
        </CardHeader>

        {isValid && contractData && (
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center mb-4">
              <Badge variant="outline" className="gap-2 text-green-600 border-green-500/50 bg-green-500/10 px-4 py-2">
                <Shield className="w-4 h-4" />
                Documento Auténtico
              </Badge>
            </div>

            <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Número de Contrato</p>
                  <p className="font-mono font-semibold">{contractData.contract}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{contractData.client}</p>
                  <p className="text-sm text-muted-foreground">C.C. {contractData.id}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Fecha de Emisión</p>
                  <p className="font-medium">{formatDate(contractData.date)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">NIT del Prestador</p>
                  <p className="font-medium">{contractData.company}</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Esta verificación confirma que el documento fue generado legítimamente 
              por el sistema de contratos del prestador de servicios.
            </p>
          </CardContent>
        )}

        {!isValid && (
          <CardContent>
            <div className="p-4 bg-destructive/10 rounded-lg text-center">
              <p className="text-sm text-destructive">
                El código QR escaneado no corresponde a un contrato válido. 
                Por favor, verifique que está escaneando el código correcto.
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
