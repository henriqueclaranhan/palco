import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Share2, X } from 'lucide-react';
import {
  canNativeShare,
  copyToClipboard,
  shareInviteLink,
} from '@/infrastructure/browserApis';

interface InviteDialogProps {
  open: boolean;
  roomCode: string;
  inviteUrl: string;
  onClose: () => void;
  onCopied: (message: string) => void;
}

export function InviteDialog({
  open,
  roomCode,
  inviteUrl,
  onClose,
  onCopied,
}: InviteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (!open || !qrCanvasRef.current) return;
    void QRCode.toCanvas(qrCanvasRef.current, inviteUrl, {
      width: 132,
      margin: 1,
      color: {
        dark: '#101214',
        light: '#FFFFFF',
      },
    });
  }, [open, inviteUrl]);

  // light-dismiss fallback for browsers without <dialog closedby="any"> (Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
    };

    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  const handleCopy = async () => {
    const ok = await copyToClipboard(inviteUrl);
    if (ok) {
      setCopied(true);
      onCopied('Link de convite copiado.');
      window.setTimeout(() => setCopied(false), 2200);
    } else {
      onCopied(
        'Não foi possível copiar automaticamente. Selecione o link manualmente.'
      );
    }
  };

  const handleShare = async () => {
    await shareInviteLink(inviteUrl, roomCode);
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby="invite-dialog-title"
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-header">
        <h1 id="invite-dialog-title" className="modal-title">
          Convidar coapresentador
        </h1>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Fechar janela de convite"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="modal-body">
        <div className="qr-block">
          <canvas
            ref={qrCanvasRef}
            className="qr-canvas"
            width={132}
            height={132}
            aria-label={`Código QR da sala ${roomCode}`}
          />
          <div>
            <p className="join-label">Código da sala</p>
            <p className="room-code-display" translate="no">
              {roomCode}
            </p>
            <p className="ephemeral-note">
              Escaneie pelo celular ou envie o link abaixo.
            </p>
          </div>
        </div>

        <div className="join-bar">
          <label htmlFor="invite-url-input" className="join-label">
            Link de acesso temporário
          </label>
          <div className="link-copy-row">
            <input
              id="invite-url-input"
              type="text"
              readOnly
              value={inviteUrl}
              className="link-readonly"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              autoFocus
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              <span>{copied ? 'Copiado' : 'Copiar link'}</span>
            </button>
          </div>
        </div>

        <p className="ephemeral-note">
          Sem login e sem nuvem: o PDF é enviado direto do seu navegador ao
          coapresentador e o link deixa de funcionar assim que você encerrar ou fechar
          esta aba.
        </p>
      </div>

      <div className="modal-footer">
        {canNativeShare() && (
          <button type="button" className="btn btn-surface" onClick={handleShare}>
            <Share2 size={16} aria-hidden="true" />
            <span>Compartilhar</span>
          </button>
        )}
        <button type="button" className="btn btn-surface" onClick={onClose}>
          Fechar
        </button>
      </div>
    </dialog>
  );
}
