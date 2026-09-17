import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** When set, the user must type this exact text to enable the confirm button. */
  typeToConfirm?: string | undefined;
  danger?: boolean;
  busy?: boolean;
  error?: string | null | undefined;
  onConfirm(typed: string): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, typeToConfirm, danger, busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTyped('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const matches = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase();
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-title`} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) onConfirm(typed.trim());
        }}
      >
        <h2 id={`${id}-title`} className="dialog-title">
          {title}
        </h2>
        <div className="dialog-text">{body}</div>
        {typeToConfirm && (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-confirm`}>
              Type <strong className="dialog-confirm-word">{typeToConfirm}</strong> to confirm
            </label>
            <input id={`${id}-confirm`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!matches || busy}>
            {busy && <span className="spinner" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
