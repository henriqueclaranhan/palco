export type PdfLoadErrorCode =
  'password_required' | 'password_incorrect' | 'corrupted' | 'unknown';

export const PDF_PASSWORD_RESPONSE = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2,
} as const;

const CORRUPTED_ERROR_NAMES = new Set([
  'InvalidPDFException',
  'FormatError',
  'MissingPDFException',
  'UnexpectedResponseException',
]);

export class PdfLoadError extends Error {
  readonly code: PdfLoadErrorCode;

  constructor(code: PdfLoadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfLoadError';
    this.code = code;
  }
}

export function isPdfLoadError(err: unknown): err is PdfLoadError {
  return err instanceof PdfLoadError;
}

export function classifyPdfLoadError(err: unknown): PdfLoadError {
  if (err instanceof PdfLoadError) {
    return err;
  }

  const name = getErrorName(err);
  const code = getErrorCode(err);

  if (name === 'PasswordException') {
    if (code === PDF_PASSWORD_RESPONSE.INCORRECT_PASSWORD) {
      return new PdfLoadError(
        'password_incorrect',
        'Senha incorreta. Verifique e tente novamente.',
        { cause: err }
      );
    }
    return new PdfLoadError('password_required', 'Este PDF é protegido por senha.', {
      cause: err,
    });
  }

  if (name !== null && CORRUPTED_ERROR_NAMES.has(name)) {
    return new PdfLoadError(
      'corrupted',
      'Este arquivo PDF parece estar corrompido ou inválido.',
      { cause: err }
    );
  }

  const message = err instanceof Error ? err.message : '';
  if (/invalid pdf|corrupt|bad xref|startxref|not a pdf/i.test(message)) {
    return new PdfLoadError(
      'corrupted',
      'Este arquivo PDF parece estar corrompido ou inválido.',
      { cause: err }
    );
  }

  return new PdfLoadError(
    'unknown',
    'Não foi possível abrir este PDF. Tente novamente com outro arquivo.',
    { cause: err }
  );
}

export function getHostPdfErrorMessage(err: unknown): string {
  const classified = classifyPdfLoadError(err);
  switch (classified.code) {
    case 'password_required':
      return 'Este PDF é protegido por senha. Abertura cancelada.';
    case 'password_incorrect':
      return 'Senha incorreta. Verifique e tente novamente.';
    case 'corrupted':
      return 'Este arquivo PDF parece estar corrompido ou inválido.';
    case 'unknown':
      return 'Não foi possível abrir este PDF. Tente novamente com outro arquivo.';
  }
}

export function getGuestPdfErrorMessage(err: unknown): string {
  const classified = classifyPdfLoadError(err);
  switch (classified.code) {
    case 'password_required':
      return 'Este PDF é protegido por senha e requer a senha para ser exibido.';
    case 'password_incorrect':
      return 'Senha incorreta. Verifique e tente novamente.';
    case 'corrupted':
      return 'O PDF recebido está corrompido ou em um formato inválido.';
    case 'unknown':
      return 'Não foi possível renderizar o PDF recebido.';
  }
}

function getErrorName(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function getErrorCode(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : null;
  }
  return null;
}
