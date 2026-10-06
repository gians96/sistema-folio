import { useRef, useState } from "react";
import { Pencil } from "lucide-react";

/** Nombre de un trabajo que se edita en el sitio (Enter guarda, Escape cancela). */
export function EditableTitle({
  value,
  onSave,
  disabled = false,
}: {
  value: string;
  onSave: (title: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);
  async function commit(text: string) {
    setDraft(null);
    const title = text.trim();
    if (!title || title === value) return;
    setSaving(true);
    try {
      await onSave(title);
    } catch {
      // Quien guarda muestra el error.
    } finally {
      setSaving(false);
    }
  }
  if (draft !== null)
    return (
      <input
        className="title-input"
        aria-label="Nombre del trabajo"
        autoFocus
        maxLength={120}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (cancelled.current) setDraft(null);
          else void commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  return (
    <button
      type="button"
      className="title-button"
      title="Cambiar el nombre"
      disabled={disabled || saving}
      onClick={() => {
        cancelled.current = false;
        setDraft(value);
      }}
    >
      <strong>{value}</strong>
      <Pencil size={13} aria-hidden="true" />
    </button>
  );
}
