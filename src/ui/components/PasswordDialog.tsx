import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, X } from 'lucide-react';

interface PasswordDialogProps {
  open: boolean;
  fileName: string;
  errorMessage: string | null;
  submitting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  title?: string;
  description?: React.ReactNode;
  label?: string;
  hint?: string;
  submitLabel?: string;
  submittingLabel?: string;
  emptyErrorMessage?: string;
  cancelAriaLabel?: string;
}

export function PasswordDialog({
  open,
  fileName,
  errorMessage,
  submitting,
  onSubmit,
  onCancel,
  title = 'PDF protegido por senha',
  description,
  label = 'Senha do arquivo',
  hint = 'A senha é usada apenas localmente no seu navegador para descriptografar o PDF e nunca é enviada ou salva.',
  submitLabel = 'Abrir PDF',
  submittingLabel = 'Desbloqueando…',
  emptyErrorMessage = 'Digite a senha do PDF.',
  cancelAriaLabel = 'Cancelar abertura do PDF',
}: PasswordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const toggleWarningId = useId();

  const displayedError = localError ?? errorMessage;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setShowPassword(false);
      setLocalError(null);
    }
  }, [open, fileName]);

  useEffect(() => {
    if (open && errorMessage && !submitting) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, errorMessage, submitting]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (password.length === 0) {
      setLocalError(emptyErrorMessage);
      inputRef.current?.focus();
      return;
    }

    setLocalError(null);
    onSubmit(password);
  };

  const describedBy = displayedError ? `${errorId} ${hintId}` : hintId;

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (openRef.current) {
          onCancel();
        }
      }}
    >
      <div className="modal-header">
        <h1 id={titleId} className="modal-title modal-title-with-icon">
          <Lock size={18} aria-hidden="true" />
          <span>{title}</span>
        </h1>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={cancelAriaLabel}
          onClick={onCancel}
          disabled={submitting}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="modal-body">
          <p className="stage-state-desc">
            {description ?? (
              <>
                O arquivo <strong>{fileName}</strong> exige senha para ser aberto.
              </>
            )}
          </p>

          <div className="password-field">
            <label htmlFor={inputId} className="join-label">
              {label}
            </label>
            <div className="password-input-row">
              <input
                ref={inputRef}
                id={inputId}
                name="pdfPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                autoFocus
                disabled={submitting}
                className="password-input"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (localError) setLocalError(null);
                }}
                aria-invalid={Boolean(displayedError)}
                aria-describedby={describedBy}
              />
              <button
                type="button"
                className="btn btn-surface btn-icon"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-describedby={toggleWarningId}
                disabled={submitting}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
              <span id={toggleWarningId} className="sr-only">
                Atenção: isso exibirá a senha na tela.
              </span>
            </div>

            {displayedError && (
              <p id={errorId} className="password-error" role="alert">
                {displayedError}
              </p>
            )}

            <p id={hintId} className="ephemeral-note">
              {hint}
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-surface"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
