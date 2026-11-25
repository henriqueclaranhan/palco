import { describe, expect, it } from 'vitest';
import {
  PDF_PASSWORD_RESPONSE,
  PdfLoadError,
  classifyPdfLoadError,
  getGuestPdfErrorMessage,
  getHostPdfErrorMessage,
  isPdfLoadError,
} from '../pdfErrors';

function makeNamedError(name: string, message = '', code?: number): Error {
  const err = new Error(message) as Error & { code?: number };
  err.name = name;
  if (code !== undefined) {
    err.code = code;
  }
  return err;
}

describe('PDF load error classification', () => {
  it('classifies pdf.js PasswordException (NEED_PASSWORD) as password_required', () => {
    const err = makeNamedError(
      'PasswordException',
      'No password given',
      PDF_PASSWORD_RESPONSE.NEED_PASSWORD
    );

    const classified = classifyPdfLoadError(err);

    expect(isPdfLoadError(classified)).toBe(true);
    expect(classified.code).toBe('password_required');
    expect(classified.cause).toBe(err);
  });

  it('classifies pdf.js PasswordException (INCORRECT_PASSWORD) as password_incorrect', () => {
    const err = makeNamedError(
      'PasswordException',
      'Incorrect Password',
      PDF_PASSWORD_RESPONSE.INCORRECT_PASSWORD
    );

    const classified = classifyPdfLoadError(err);

    expect(classified.code).toBe('password_incorrect');
    expect(classified.message).toMatch(/incorreta/i);
  });

  it('differentiates InvalidPDFException and FormatError as corrupted', () => {
    const invalidPdf = classifyPdfLoadError(
      makeNamedError('InvalidPDFException', 'Invalid PDF structure.')
    );
    const formatErr = classifyPdfLoadError(
      makeNamedError('FormatError', 'Bad XRef entry')
    );
    const genericCorrupt = classifyPdfLoadError(
      new Error('Failed to parse: Invalid PDF header')
    );

    expect(invalidPdf.code).toBe('corrupted');
    expect(formatErr.code).toBe('corrupted');
    expect(genericCorrupt.code).toBe('corrupted');
  });

  it('falls back to unknown for unrelated errors and preserves existing PdfLoadError', () => {
    const unknown = classifyPdfLoadError(new Error('Worker crashed'));
    expect(unknown.code).toBe('unknown');

    const existing = new PdfLoadError('password_required', 'custom');
    expect(classifyPdfLoadError(existing)).toBe(existing);
  });

  it('produces distinct host and guest messages for corrupted vs password errors', () => {
    const pwdErr = makeNamedError(
      'PasswordException',
      'No password given',
      PDF_PASSWORD_RESPONSE.NEED_PASSWORD
    );
    const corruptErr = makeNamedError('InvalidPDFException', 'Invalid PDF');

    expect(getHostPdfErrorMessage(pwdErr)).toMatch(/senha/i);
    expect(getHostPdfErrorMessage(corruptErr)).toMatch(/corrompido/i);
    expect(getHostPdfErrorMessage(pwdErr)).not.toBe(getHostPdfErrorMessage(corruptErr));

    expect(getGuestPdfErrorMessage(pwdErr)).toMatch(/senha/i);
    expect(getGuestPdfErrorMessage(corruptErr)).toMatch(/corrompido/i);
    expect(getGuestPdfErrorMessage(pwdErr)).not.toBe(
      getGuestPdfErrorMessage(corruptErr)
    );
  });
});
