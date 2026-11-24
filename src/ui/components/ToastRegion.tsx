import { X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  text: string;
}

interface ToastRegionProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  const latestText = toasts.length > 0 ? toasts[toasts.length - 1].text : '';

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {latestText}
      </div>

      {toasts.length > 0 && (
        <div
          className="toast-region"
          role="region"
          aria-label="Notificações da apresentação"
        >
          {toasts.map((toast) => (
            <div key={toast.id} className="toast-item">
              <span>{toast.text}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Dispensar notificação"
                onClick={() => onDismiss(toast.id)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
