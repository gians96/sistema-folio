// En producción la API vive en su propio subdominio (VITE_API_URL, fijado al compilar);
// en desarrollo queda vacío y Vite reenvía /api al backend local.
const apiBase = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
// La sesión (JWT de 12 horas) viaja en una cookie HttpOnly: no se guarda en el navegador.
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}/api${url}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/auth/"))
      window.dispatchEvent(new Event("folio:unauthorized"));
    const body = await response.json().catch(() => ({
      // Un proxy (p. ej. Cloudflare) puede rechazar la carga con una página HTML.
      error:
        response.status === 413
          ? "El archivo es demasiado grande para el servidor."
          : "No se pudo conectar con el servidor.",
    }));
    throw new Error(body.error ?? "No se pudo completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get("Content-Type")?.includes("application/pdf"))
    return (await response.arrayBuffer()) as T;
  return (await response.json()) as T;
}
