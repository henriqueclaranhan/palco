import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Continuar apresentando',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby="confirm-dialog-title"
      onClose={() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const result = dialog.returnValue;
        dialog.returnValue = '';
        if (result === 'confirm') {
          onConfirm();
        } else {
          onCancel();
        }
      }}
    >
      <div className="modal-header">
        <h1 id="confirm-dialog-title" className="modal-title">
          {title}
        </h1>
      </div>

      <div className="modal-body">
        <p className="stage-state-desc">{description}</p>
      </div>

      <form method="dialog" className="modal-footer">
        <button type="submit" value="cancel" className="btn btn-surface" autoFocus>
          {cancelLabel}
        </button>
        <button type="submit" value="confirm" className="btn btn-danger">
          {confirmLabel}
        </button>
      </form>
    </dialog>
  );
}
