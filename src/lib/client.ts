/** Thin fetch wrapper for client components. Errors are surfaced verbatim. */
export type ApiError = { code: string; message: string };

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const error = (payload as { error?: ApiError }).error;
    throw Object.assign(new Error(error?.message ?? `Request failed (${response.status})`), {
      code: error?.code ?? "unknown",
      status: response.status,
    });
  }

  return (payload as { data: T }).data;
}
