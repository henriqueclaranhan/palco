import { PdfLoadError, classifyPdfLoadError } from '@/domain/pdfErrors';
import type { PasswordRequest, SessionEngine } from './types';

export interface PdfLoadMetadata {
  fileName: string;
}

export type PdfLoadOutcome<TMeta extends PdfLoadMetadata> =
  | { status: 'loaded'; totalPages: number; meta: TMeta; bytes: Uint8Array }
  | { status: 'password_required'; meta: TMeta }
  | { status: 'error'; error: PdfLoadError; meta: TMeta }
  | { status: 'stale' };

interface PendingDocument<TMeta extends PdfLoadMetadata> {
  meta: TMeta;
  bytes: Uint8Array;
}

type PasswordRequestSetter = (
  next:
    PasswordRequest | null | ((prev: PasswordRequest | null) => PasswordRequest | null)
) => void;

const EMPTY_PASSWORD_RETRY_MESSAGE = 'Digite a senha para desbloquear este PDF.';

export class PdfDocumentLoader<TMeta extends PdfLoadMetadata> {
  private readonly engine: SessionEngine;
  private readonly setPasswordRequest: PasswordRequestSetter;
  private loadSeq = 0;
  private pending: PendingDocument<TMeta> | null = null;

  constructor(engine: SessionEngine, setPasswordRequest: PasswordRequestSetter) {
    this.engine = engine;
    this.setPasswordRequest = setPasswordRequest;
  }

  get currentSequence(): number {
    return this.loadSeq;
  }

  isCurrent(sequence: number): boolean {
    return sequence === this.loadSeq;
  }

  invalidate(): void {
    this.loadSeq += 1;
    this.pending = null;
    this.setPasswordRequest(null);
  }

  async load(
    meta: TMeta,
    bytes: Uint8Array,
    options?: { password?: string; isRetry?: boolean }
  ): Promise<PdfLoadOutcome<TMeta>> {
    const seq = ++this.loadSeq;

    try {
      const totalPages = await this.engine.load(bytes, {
        password: options?.password,
      });
      if (seq !== this.loadSeq) {
        return { status: 'stale' };
      }

      this.pending = null;
      this.setPasswordRequest(null);
      return { status: 'loaded', totalPages, meta, bytes };
    } catch (err) {
      if (seq !== this.loadSeq) {
        return { status: 'stale' };
      }

      const classified = classifyPdfLoadError(err);
      if (isPasswordError(classified)) {
        this.pending = { meta, bytes };
        this.setPasswordRequest({
          fileName: meta.fileName,
          errorMessage: resolvePasswordErrorMessage(
            classified,
            Boolean(options?.isRetry)
          ),
          submitting: false,
        });
        return { status: 'password_required', meta };
      }

      this.pending = null;
      this.setPasswordRequest(null);
      return { status: 'error', error: classified, meta };
    }
  }

  async submitPassword(password: string): Promise<PdfLoadOutcome<TMeta> | null> {
    const pending = this.pending;
    if (!pending) return null;

    this.setPasswordRequest((prev) =>
      prev ? { ...prev, errorMessage: null, submitting: true } : null
    );

    return this.load(pending.meta, pending.bytes, { password, isRetry: true });
  }

  cancelPassword(): TMeta | null {
    const pending = this.pending;
    this.pending = null;
    this.setPasswordRequest(null);
    return pending?.meta ?? null;
  }
}

function isPasswordError(error: PdfLoadError): boolean {
  return error.code === 'password_required' || error.code === 'password_incorrect';
}

function resolvePasswordErrorMessage(
  error: PdfLoadError,
  isRetry: boolean
): string | null {
  if (error.code === 'password_incorrect') {
    return error.message;
  }
  return isRetry ? EMPTY_PASSWORD_RETRY_MESSAGE : null;
}
