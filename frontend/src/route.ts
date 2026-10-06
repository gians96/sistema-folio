import { useEffect, useState } from "react";

export type Route =
  | { view: "home" }
  | { view: "new" }
  | { view: "job"; id: string }
  | { view: "admin" };
export function parseRoute(hash = location.hash): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "nuevo") return { view: "new" };
  if (path === "admin") return { view: "admin" };
  const job = /^trabajo\/([0-9a-f-]{36})$/i.exec(path);
  return job ? { view: "job", id: job[1] } : { view: "home" };
}
export function navigate(path: string) {
  location.hash = `#${path}`;
}
// El editor avisa si hay cambios sin guardar antes de cambiar de vista o cerrar sesión.
let unsaved = false;
export function setUnsaved(value: boolean) {
  unsaved = value;
}
export function confirmLeave() {
  return (
    !unsaved || confirm("Hay cambios sin guardar en el trabajo. ¿Salir de todos modos?")
  );
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const change = (event: HashChangeEvent) => {
      if (!confirmLeave()) {
        // Vuelve a la dirección anterior sin cambiar de vista.
        history.replaceState(null, "", event.oldURL);
        return;
      }
      setRoute(parseRoute());
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return route;
}
