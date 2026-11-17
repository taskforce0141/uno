import { X } from 'lucide-react';
import { ToastItem } from '../../context/GameContext';

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0 pointer-events-none">
      {toasts.map((t) => {
        const toneStyles =
          t.tone === 'error'
            ? 'bg-rose-950/95 border-rose-700 text-rose-100'
            : t.tone === 'success'
            ? 'bg-emerald-950/95 border-emerald-700 text-emerald-100'
            : 'bg-slate-900/95 border-slate-700 text-slate-100';

        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium ${toneStyles}`}
          >
            <span className="leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
