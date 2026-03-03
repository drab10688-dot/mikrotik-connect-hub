import React from "react";
import { Button } from "@/components/ui/button";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || "Ocurrió un error inesperado",
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("App runtime error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-semibold">Se produjo un error en la página</h1>
            <p className="text-sm text-muted-foreground break-words">
              {this.state.errorMessage}
            </p>
            <Button onClick={this.handleReload}>Recargar</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
