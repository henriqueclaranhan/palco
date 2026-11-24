import { env } from '@/config/env';
import { MAX_PDF_BYTES } from './protocol';

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function isPdfFile(file: Pick<FileLike, 'name' | 'type'>): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function validatePdfFile(file: FileLike): string | null {
  if (!isPdfFile(file)) {
    return 'Selecione um arquivo no formato PDF (.pdf).';
  }
  if (file.size === 0) {
    return 'O arquivo PDF selecionado está vazio.';
  }
  if (file.size > MAX_PDF_BYTES) {
    return `O arquivo excede o limite máximo de ${env.maxPdfMb} MB.`;
  }
  return null;
}
