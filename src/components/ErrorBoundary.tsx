import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  error?: string;
  onRetry?: () => void;
}

export const ErrorBoundary = ({ error, onRetry }: ErrorBoundaryProps) => {
  if (!error) return null;

  const isTimeoutError = error.includes('timeout') || error.includes('timed out');
  const isConnectionError = error.includes('connection') || error.includes('connect');

  return (
    <Alert variant="destructive" className="my-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>
        {isTimeoutError ? 'Timeout de Conexión' : isConnectionError ? 'Error de Conexión' : 'Error'}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-sm">
          {isTimeoutError 
            ? 'La conexión al MikroTik tardó demasiado. Esto puede deberse a que el dispositivo está ocupado o hay problemas de red.'
            : isConnectionError
            ? 'No se pudo conectar al MikroTik. Verifica que el dispositivo esté encendido y accesible.'
            : error}
        </p>
        {onRetry && (
          <Button 
            onClick={onRetry} 
            variant="outline" 
            size="sm"
            className="mt-2"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reintentar
          </Button>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          💡 Consejo: Si esto ocurre frecuentemente, intenta refrescar menos páginas al mismo tiempo.
        </p>
      </AlertDescription>
    </Alert>
  );
};
