import { useEffect, useMemo, useState } from "react";

/** Quita acentos y normaliza para búsquedas tolerantes. */
export const normalize = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Búsqueda por múltiples términos (todos deben coincidir) + paginación.
 * Cada término puede aparecer en cualquiera de los campos indexados.
 */
export function usePagedSearch<T>(
  items: T[],
  fields: (item: T) => (string | number | null | undefined)[],
  options?: { pageSize?: number },
) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options?.pageSize ?? 25);

  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    return items.filter((item) => {
      const haystack = normalize(fields(item).filter((v) => v !== null && v !== undefined).join(" "));
      return terms.every((t) => haystack.includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [query, pageSize, items.length]);

  const current = page > pageCount ? pageCount : page;
  const start = (current - 1) * pageSize;
  const paged = useMemo(() => filtered.slice(start, start + pageSize), [filtered, start, pageSize]);

  return {
    query,
    setQuery,
    paged,
    filtered,
    total,
    page: current,
    setPage,
    pageCount,
    pageSize,
    setPageSize,
    from: total ? start + 1 : 0,
    to: Math.min(start + pageSize, total),
  };
}

export type PagedSearch<T> = ReturnType<typeof usePagedSearch<T>>;
