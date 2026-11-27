import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  canPerformAction,
  generateCoPresenterPassword,
  generateRoomCode,
  isValidRoomCode,
  normalizeCoPresenterPassword,
  normalizeRoomCode,
  parsePeerMessage,
  roomCodeToPeerId,
} from '../protocol';
import { PdfChunkAssembler, slicePdfIntoChunks } from '../chunker';
import { clampPage, computeTargetPage, formatBytes } from '../session';
import { validatePdfFile } from '../pdfValidation';

describe('protocol authority & validation', () => {
  it('enforces host-only document replacement, spectator config, and session termination', () => {
    expect(canPerformAction('host', 'replace_document')).toBe(true);
    expect(canPerformAction('host', 'end_session')).toBe(true);
    expect(canPerformAction('host', 'invite_copresenter')).toBe(true);
    expect(canPerformAction('host', 'configure_spectators')).toBe(true);
    expect(canPerformAction('host', 'navigate')).toBe(true);
    expect(canPerformAction('host', 'toggle_fullscreen')).toBe(true);

    expect(canPerformAction('co-presenter', 'replace_document')).toBe(false);
    expect(canPerformAction('co-presenter', 'end_session')).toBe(false);
    expect(canPerformAction('co-presenter', 'invite_copresenter')).toBe(false);
    expect(canPerformAction('co-presenter', 'configure_spectators')).toBe(false);
    expect(canPerformAction('co-presenter', 'navigate')).toBe(true);
    expect(canPerformAction('co-presenter', 'toggle_fullscreen')).toBe(true);

    expect(canPerformAction('spectator', 'replace_document')).toBe(false);
    expect(canPerformAction('spectator', 'end_session')).toBe(false);
    expect(canPerformAction('spectator', 'invite_copresenter')).toBe(false);
    expect(canPerformAction('spectator', 'configure_spectators')).toBe(false);
    expect(canPerformAction('spectator', 'navigate')).toBe(false);
    expect(canPerformAction('spectator', 'toggle_fullscreen')).toBe(true);
  });

  it('generates and normalizes valid room codes', () => {
    const code = generateRoomCode();
    expect(isValidRoomCode(code)).toBe(true);
    expect(normalizeRoomCode(code.toLowerCase().replace('-', ''))).toBe(code);
    expect(roomCodeToPeerId(code)).toMatch(/^palco-v1-[a-z0-9]{8}$/);
  });

  it('validates well-formed messages and rejects malformed payloads', () => {
    const valid = parsePeerMessage({
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: 'abc123',
      action: 'next',
    });
    expect(valid).toEqual({
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: 'abc123',
      action: 'next',
    });

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'PEER_LEAVE',
      })
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'PEER_LEAVE',
    });

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'ROOM_CONFIG',
        spectatorMode: 'free',
      })
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: 'free',
    });

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'ROOM_CONFIG',
        spectatorMode: 'invalid',
      })
    ).toBeNull();

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'AUTH_REQUIRED',
        reason: 'invalid_password',
      })
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_REQUIRED',
      reason: 'invalid_password',
    });

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'AUTH_SUBMIT',
        password: '  ab12cd  ',
      })
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_SUBMIT',
      password: 'ab12cd',
    });

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'AUTH_SUBMIT',
        password: '   ',
      })
    ).toBeNull();

    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'AUTH_OK',
      })
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_OK',
    });

    const pwd = generateCoPresenterPassword();
    expect(pwd).toMatch(/^[A-Z0-9]{6}$/);
    expect(normalizeCoPresenterPassword(`  ${pwd.toLowerCase()} `)).toBe(pwd);

    expect(parsePeerMessage(null)).toBeNull();
    expect(parsePeerMessage({ v: 999, type: 'NAVIGATE' })).toBeNull();
    expect(
      parsePeerMessage({
        v: PROTOCOL_VERSION,
        type: 'NAVIGATE',
        docId: 'abc',
        action: 'goto',
        page: 0,
      })
    ).toBeNull();
  });
});

describe('PDF binary chunker & assembler', () => {
  it('slices and reassembles binary payloads losslessly (even out of order)', () => {
    const payload = new Uint8Array(150_000);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = i % 251;
    }

    const chunks = slicePdfIntoChunks(payload, 32_768);
    expect(chunks.length).toBe(5);

    const assembler = new PdfChunkAssembler({
      docId: 'doc-1',
      fileName: 'slides.pdf',
      byteLength: payload.byteLength,
      totalChunks: chunks.length,
      initialPage: 1,
    });

    // Feed out of order + duplicate chunk
    assembler.addChunk(4, chunks[4]);
    assembler.addChunk(1, chunks[1]);
    assembler.addChunk(1, chunks[1]); // duplicate ignored
    expect(assembler.isComplete).toBe(false);

    assembler.addChunk(0, chunks[0]);
    assembler.addChunk(3, chunks[3]);
    assembler.addChunk(2, chunks[2]);
    expect(assembler.isComplete).toBe(true);
    expect(assembler.progress).toBe(1);

    const rebuilt = assembler.assemble();
    expect(rebuilt.byteLength).toBe(payload.byteLength);
    expect(rebuilt).toEqual(payload);
  });
});

describe('session page calculation', () => {
  it('clamps and computes navigation safely', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(computeTargetPage(1, 10, { action: 'prev', docId: 'd' })).toBe(1);
    expect(computeTargetPage(10, 10, { action: 'next', docId: 'd' })).toBe(10);
    expect(computeTargetPage(3, 10, { action: 'next', docId: 'd' })).toBe(4);
    expect(computeTargetPage(3, 10, { action: 'goto', page: 7, docId: 'd' })).toBe(7);
    expect(formatBytes(1_572_864)).toBe('1,5\u00A0MB');
  });
});

describe('PDF file validation', () => {
  it('accepts valid PDF files and rejects invalid type, empty, or oversized files', () => {
    expect(
      validatePdfFile({ name: 'deck.pdf', type: 'application/pdf', size: 1024 })
    ).toBeNull();
    expect(validatePdfFile({ name: 'DECK.PDF', type: '', size: 512 })).toBeNull();
    expect(
      validatePdfFile({ name: 'notes.txt', type: 'text/plain', size: 100 })
    ).not.toBeNull();
    expect(
      validatePdfFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 })
    ).not.toBeNull();
    expect(
      validatePdfFile({
        name: 'huge.pdf',
        type: 'application/pdf',
        size: 101 * 1024 * 1024,
      })
    ).not.toBeNull();
  });
});
