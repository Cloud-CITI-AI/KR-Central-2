"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

export interface ToastApi {
  readonly toasts: readonly ToastMessage[];
  /** Announce a short, transient status ("Saved", "3 files uploaded"). */
  readonly toast: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  readonly children: ReactNode;
  readonly durationMs?: number;
}

/** Transient status messages for the `<ToastRegion>` live region (save and upload status, §12). */
export function ToastProvider({ children, durationMs = 4000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const toast = useCallback(
    (text: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, text }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setToasts((current) => current.filter((t) => t.id !== id));
      }, durationMs);
      timers.current.add(timer);
    },
    [durationMs],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const value = useMemo(() => ({ toasts, toast }), [toasts, toast]);
  return <ToastContext value={value}>{children}</ToastContext>;
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
