import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Controls {
  query: string;
  setQuery: (value: string) => void;
  total: number;
  page: number;
  setPage: (value: number) => void;
  pageCount: number;
  pageSize: number;
  setPageSize: (value: number) => void;
  from: number;
  to: number;
}

/** Caja de búsqueda con contador de resultados. */
export function SearchBox({
  controls,
  placeholder = "Buscar…",
  className = "",
}: {
  controls: Pick<Controls, "query" | "setQuery" | "total">;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex-1 min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-9 pr-9"
          placeholder={placeholder}
          value={controls.query}
          onChange={(e) => controls.setQuery(e.target.value)}
        />
        {controls.query && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => controls.setQuery("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{controls.total} resultado(s)</span>
    </div>
  );
}

/** Navegación por páginas con tamaño configurable. */
export function Pager({ controls, className = "" }: { controls: Controls; className?: string }) {
  const { page, pageCount, setPage, pageSize, setPageSize, from, to, total } = controls;

  const pages = (() => {
    const out: number[] = [];
    const start = Math.max(1, Math.min(page - 2, pageCount - 4));
    for (let i = start; i < start + 5 && i <= pageCount; i++) out.push(i);
    return out;
  })();

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 pt-3 ${className}`}>
      <p className="text-xs text-muted-foreground">
        Mostrando {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {pages.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={p === page ? "default" : "outline"}
            className="h-8 w-8 p-0 text-xs"
            onClick={() => setPage(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={page >= pageCount}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
