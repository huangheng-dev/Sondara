type ApiErrorBody = { error?: string; message?: string };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? "请求处理失败。");
    this.name = "ApiError";
    this.status = status;
    this.code = body.error;
  }
}

export type ListResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * Loads every page from a paginated endpoint without silently dropping records.
 * Pages are fetched in bounded parallel batches after the first response reveals
 * the total. The safety limit protects the browser from an accidental unbounded
 * export-sized query; list screens should use server filtering before this point.
 */
export const collectAllPages = async <T>(
  fetchPage: (page: number, pageSize: number) => Promise<ListResponse<T>>,
  options: { pageSize?: number; maxItems?: number } = {},
): Promise<ListResponse<T>> => {
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 100));
  const maxItems = Math.max(pageSize, options.maxItems ?? 10_000);
  const first = await fetchPage(1, pageSize);
  const target = Math.min(first.total, maxItems);
  const pageCount = Math.ceil(target / pageSize);
  if (pageCount <= 1) return { ...first, items: first.items.slice(0, target) };

  const pages: ListResponse<T>[] = [];
  const parallelLimit = 5;
  for (let start = 2; start <= pageCount; start += parallelLimit) {
    const end = Math.min(pageCount, start + parallelLimit - 1);
    const batch = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, index) => fetchPage(start + index, pageSize)),
    );
    pages.push(...batch);
  }
  return {
    items: [first, ...pages].flatMap(page => page.items).slice(0, target),
    page: 1,
    pageSize: target,
    total: first.total,
  };
};

export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const downloadFile = async (path: string, defaultFilename: string) => {
  const response = await fetch(`/api${path}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body as ApiErrorBody);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? defaultFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
