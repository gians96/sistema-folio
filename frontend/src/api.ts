export type Session = { id: string; token: string };
export async function api<T>(
  url: string,
  session?: Session | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "No se pudo conectar con el servidor." }));
    throw new Error(body.error ?? "No se pudo completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get("Content-Type")?.includes("application/pdf"))
    return (await response.arrayBuffer()) as T;
  return (await response.json()) as T;
}
