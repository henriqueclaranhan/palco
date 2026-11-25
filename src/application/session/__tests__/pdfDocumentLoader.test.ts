import { describe, expect, it, vi } from 'vitest';
import { PdfLoadError } from '@/domain/pdfErrors';
import { PdfDocumentLoader } from '../pdfDocumentLoader';
import type { PasswordRequest, SessionEngine } from '../types';

function createPasswordState() {
  let current: PasswordRequest | null = null;
  const setPasswordRequest = (
    next:
      | PasswordRequest
      | null
      | ((prev: PasswordRequest | null) => PasswordRequest | null)
  ) => {
    current = typeof next === 'function' ? next(current) : next;
  };
  return {
    get: () => current,
    setPasswordRequest,
  };
}

describe('PdfDocumentLoader', () => {
  it('loads a PDF and clears password state on success', async () => {
    const engine: SessionEngine = {
      load: vi.fn().mockResolvedValue(12),
      destroy: vi.fn(),
    };
    const pw = createPasswordState();
    const loader = new PdfDocumentLoader(engine, pw.setPasswordRequest);

    const bytes = new Uint8Array([1, 2, 3]);
    const outcome = await loader.load({ fileName: 'slides.pdf' }, bytes);

    expect(outcome).toEqual({
      status: 'loaded',
      totalPages: 12,
      meta: { fileName: 'slides.pdf' },
      bytes,
    });
    expect(pw.get()).toBeNull();
  });

  it('handles password_required -> incorrect -> valid password flow', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new PdfLoadError('password_required', 'Senha necessária.'))
      .mockRejectedValueOnce(new PdfLoadError('password_incorrect', 'Senha incorreta.'))
      .mockResolvedValueOnce(8);
    const engine: SessionEngine = { load, destroy: vi.fn() };
    const pw = createPasswordState();
    const loader = new PdfDocumentLoader(engine, pw.setPasswordRequest);

    const bytes = new Uint8Array([9, 9]);
    const first = await loader.load({ fileName: 'secret.pdf' }, bytes);
    expect(first.status).toBe('password_required');
    expect(pw.get()).toEqual({
      fileName: 'secret.pdf',
      errorMessage: null,
      submitting: false,
    });

    const wrong = await loader.submitPassword('wrong');
    expect(wrong?.status).toBe('password_required');
    expect(pw.get()).toEqual({
      fileName: 'secret.pdf',
      errorMessage: 'Senha incorreta.',
      submitting: false,
    });

    const ok = await loader.submitPassword('correct');
    expect(ok).toEqual({
      status: 'loaded',
      totalPages: 8,
      meta: { fileName: 'secret.pdf' },
      bytes,
    });
    expect(pw.get()).toBeNull();
  });

  it('ignores stale load completions when a newer load starts', async () => {
    let resolveFirst!: (pages: number) => void;
    const firstPromise = new Promise<number>((resolve) => {
      resolveFirst = resolve;
    });

    const load = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValueOnce(5);
    const engine: SessionEngine = { load, destroy: vi.fn() };
    const pw = createPasswordState();
    const loader = new PdfDocumentLoader(engine, pw.setPasswordRequest);

    const firstLoad = loader.load({ fileName: 'old.pdf' }, new Uint8Array([1]));
    const secondOutcome = await loader.load(
      { fileName: 'new.pdf' },
      new Uint8Array([2])
    );

    resolveFirst(99);
    const firstOutcome = await firstLoad;

    expect(secondOutcome.status).toBe('loaded');
    expect(firstOutcome).toEqual({ status: 'stale' });
  });

  it('cancels a pending password prompt and returns cancelled metadata', async () => {
    const engine: SessionEngine = {
      load: vi
        .fn()
        .mockRejectedValueOnce(
          new PdfLoadError('password_required', 'Senha necessária.')
        ),
      destroy: vi.fn(),
    };
    const pw = createPasswordState();
    const loader = new PdfDocumentLoader(engine, pw.setPasswordRequest);

    await loader.load({ fileName: 'locked.pdf' }, new Uint8Array([1]));
    expect(pw.get()?.fileName).toBe('locked.pdf');

    const cancelled = loader.cancelPassword();
    expect(cancelled).toEqual({ fileName: 'locked.pdf' });
    expect(pw.get()).toBeNull();
    expect(loader.cancelPassword()).toBeNull();
  });
});
