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
