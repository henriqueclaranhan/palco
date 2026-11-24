import { MAX_PDF_BYTES } from './protocol';

// 64 KB stays safely under WebRTC SCTP limits across desktop and mobile browsers
export const CHUNK_SIZE_BYTES = 64 * 1024;

export function slicePdfIntoChunks(
  bytes: Uint8Array,
  chunkSize: number = CHUNK_SIZE_BYTES
): Uint8Array[] {
  if (bytes.byteLength === 0) {
    throw new Error('O arquivo PDF está vazio.');
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error('O arquivo excede o limite máximo de 100 MB.');
  }
  const totalChunks = Math.ceil(bytes.byteLength / chunkSize);
  const chunks: Uint8Array[] = new Array(totalChunks);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, bytes.byteLength);
    chunks[i] = bytes.slice(start, end);
  }
  return chunks;
}

export interface IncomingDocumentHeader {
  docId: string;
  fileName: string;
  byteLength: number;
  totalChunks: number;
  initialPage: number;
}

export class PdfChunkAssembler {
  readonly header: IncomingDocumentHeader;
  private readonly chunks: Array<Uint8Array | undefined>;
  private receivedCount = 0;
  private receivedBytes = 0;

  constructor(header: IncomingDocumentHeader) {
    if (header.byteLength <= 0 || header.byteLength > MAX_PDF_BYTES) {
      throw new Error('Tamanho de documento inválido.');
    }
    if (header.totalChunks <= 0) {
      throw new Error('Contagem de blocos inválida.');
    }
    this.header = header;
    this.chunks = new Array(header.totalChunks);
  }

  addChunk(index: number, data: ArrayBuffer | Uint8Array): number {
    if (index < 0 || index >= this.header.totalChunks) {
      return this.progress;
    }
    if (this.chunks[index] !== undefined) {
      return this.progress;
    }
    const view = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.chunks[index] = view;
    this.receivedCount += 1;
    this.receivedBytes += view.byteLength;
    return this.progress;
  }

  get progress(): number {
    if (this.header.totalChunks === 0) return 0;
    return Math.min(1, this.receivedCount / this.header.totalChunks);
  }

  get isComplete(): boolean {
    return this.receivedCount === this.header.totalChunks;
  }

  assemble(): Uint8Array {
    if (!this.isComplete) {
      throw new Error(
        `Transferência incompleta (${this.receivedCount}/${this.header.totalChunks} blocos).`
      );
    }
    const output = new Uint8Array(this.receivedBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!chunk) {
        throw new Error('Bloco ausente ao montar o PDF.');
      }
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (output.byteLength !== this.header.byteLength) {
      throw new Error('Tamanho final do PDF não confere com o anunciado.');
    }
    return output;
  }
}
