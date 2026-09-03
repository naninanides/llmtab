import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import { useAsync } from "@/hooks/useAsync";

interface Toast {
  id: number;
  message: string;
}

/** Auto-dismissing error toasts, top-right (StyleGuide §5). */
export function useToasts(): {
  toasts: Toast[];
  push: (message: string) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (message: string): void => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => dismiss(id), 5000);
  };
  const dismiss = (id: number): void => setToasts((t) => t.filter((x) => x.id !== id));
  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onRetry,
}: {
  toasts: Toast[];
  onRetry?: () => void;
}): ReactNode {
  return (
    <div className="fixed right-4 top-4 z-50 space-y-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="flex max-w-sm items-center justify-between gap-3 rounded-card border border-danger/40 bg-surface px-4 py-3 text-sm shadow-lg"
        >
          <span>{t.message}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="shrink-0 rounded-control border border-border px-2 py-1 text-xs hover:bg-surface-2"
            >
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Sync report footer (FR-8 / T5.6): last sync outcome per tool. */
export function SyncFooter(): ReactNode {
  const last = useAsync(() => api.lastSync(), []);
  const [stamp, setStamp] = useState("");

  useEffect(() => {
    const tick = () =>
      setStamp(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const iv = setInterval(tick, 10_000);
    return () => clearInterval(iv);
  }, []);

  if (last.error || !last.data?.lastSync) return null;
  const s = last.data.lastSync;

  return (
    <footer className="mt-8 border-t border-border pt-4 pb-1 text-xs text-text-2">
      Last sync{" "}
      {new Date(s.finishedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
      {" · "}+{s.recordsAdded} records{s.linesSkipped > 0 ? ` · ${s.linesSkipped} skipped` : ""}
      {" · "}
      {s.entries.map((e) => `${e.tool} +${e.recordsAdded}`).join(", ")}
      {" · "}
      checked {stamp}
    </footer>
  );
}
