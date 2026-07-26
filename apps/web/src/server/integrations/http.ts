export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    label: string
  ) {
    super(`${label} failed with ${status}`);
    this.name = "HttpStatusError";
  }
}

type FetchJsonOptions = {
  label: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  body?: string;
};

export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal
  });
  if (!response.ok) {
    throw new HttpStatusError(response.status, options.label);
  }
  return (await response.json()) as T;
}
