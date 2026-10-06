import { useEffect, useRef, useState } from "react";
import { Layers, LoaderCircle } from "lucide-react";
import type { UserView } from "@folio/shared";
import { api } from "./api";

type GoogleId = {
  initialize(options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}
let script: Promise<GoogleId> | null = null;
let initializedFor = "";
// Google se inicializa una sola vez; la respuesta va a la pantalla de acceso montada.
let receive: ((credential: string) => void) | null = null;
function loadGoogle(clientId: string) {
  script ??= new Promise<GoogleId>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "https://accounts.google.com/gsi/client";
    tag.async = true;
    tag.onload = () =>
      window.google ? resolve(window.google.accounts.id) : reject(new Error());
    tag.onerror = () => {
      script = null;
      tag.remove();
      reject(new Error());
    };
    document.head.append(tag);
  });
  return script.then((id) => {
    if (initializedFor !== clientId) {
      id.initialize({
        client_id: clientId,
        callback: (response) => receive?.(response.credential),
      });
      initializedFor = clientId;
    }
    return id;
  });
}

export function Login({
  clientId,
  overlay = false,
  onLogin,
}: {
  clientId: string;
  /** La sesión caducó con un trabajo abierto: se muestra encima sin cerrarlo. */
  overlay?: boolean;
  onLogin: (user: UserView) => void;
}) {
  const button = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    receive = (credential) => {
      setBusy(true);
      setError("");
      api<{ user: UserView }>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential }),
      })
        .then(({ user }) => onLogin(user))
        .catch((reason) => setError((reason as Error).message))
        .finally(() => setBusy(false));
    };
    return () => {
      receive = null;
    };
  }, [onLogin]);
  useEffect(() => {
    let cancelled = false;
    loadGoogle(clientId)
      .then((id) => {
        if (cancelled || !button.current) return;
        button.current.replaceChildren();
        id.renderButton(button.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          locale: "es",
          width: 280,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "No se pudo cargar el acceso con Google. Revisa tu conexión o el bloqueador de contenido y recarga la página.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return (
    <div className={`auth-screen${overlay ? " overlay" : ""}`}>
      <div
        className="auth-card"
        role={overlay ? "dialog" : undefined}
        aria-modal={overlay || undefined}
        aria-labelledby="auth-title"
      >
        <div className="brand">
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          folio<span className="brand-dot">.</span>
        </div>
        <h1 id="auth-title">{overlay ? "Tu sesión terminó" : "Acceso"}</h1>
        <p>
          {overlay
            ? "Vuelve a entrar con Google para continuar. Tus cambios sin guardar siguen en pantalla."
            : "Entra con tu cuenta de Google para organizar y foliar tus documentos. Tus trabajos quedan guardados en tu cuenta."}
        </p>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <div className="google-button" ref={button} />
        {(busy || (!ready && !error)) && (
          <p className="auth-status">
            <LoaderCircle className="spin" size={16} />
            {busy ? "Ingresando…" : "Cargando Google…"}
          </p>
        )}
      </div>
    </div>
  );
}
