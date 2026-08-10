export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers: inputHeaders, body, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();
  const headers = new Headers(inputHeaders);
  const normalizedBody = (body === undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(method))
    ? "{}"
    : body;

  if (normalizedBody !== undefined && normalizedBody !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "include",
    ...rest,
    body: normalizedBody,
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
