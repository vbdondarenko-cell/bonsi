"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "error";
type ToastInput = { title: string; description?: string; tone?: Tone };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ push: (toast: ToastInput) => void } | null>(null);

const toneStyles: Record<Tone, string> = {
  info: "border-line",
  success: "border-ok/60",
  error: "border-danger/60",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Сповіщення"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-3 sm:left-auto sm:right-6 sm:w-[24rem]"
      >
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-surface-2 p-4 shadow-xl",
                toneStyles[item.tone ?? "info"],
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-sm leading-relaxed text-muted">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Закрити сповіщення"
                className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:text-fg"
              >
                <span aria-hidden="true">×</span>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast має використовуватись усередині ToastProvider");
  return context;
}
