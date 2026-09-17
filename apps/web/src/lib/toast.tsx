import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void } | undefined;
}

const ToastContext = createContext<(message: string, action?: Toast['action']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.action && (
              <button className="btn btn-sm btn-ghost" style={{ color: 'inherit' }} onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
