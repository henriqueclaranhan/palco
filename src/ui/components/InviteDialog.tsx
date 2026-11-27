import { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Eye, KeyRound, RefreshCw, Share2, Users, X } from 'lucide-react';
import type { GuestRole, SpectatorMode } from '@/domain/protocol';
import {
  canNativeShare,
  copyToClipboard,
  shareInviteLink,
} from '@/infrastructure/browserApis';

interface InviteDialogProps {
  open: boolean;
  roomCode: string;
  coPresenterUrl: string;
  spectatorUrl: string;
  coPresenterPassword: string | null;
  spectatorMode: SpectatorMode;
  onChangeSpectatorMode: (mode: SpectatorMode) => void;
  onRegeneratePassword: () => void;
  onClose: () => void;
  onCopied: (message: string) => void;
}

export function InviteDialog({
  open,
  roomCode,
  coPresenterUrl,
  spectatorUrl,
  coPresenterPassword,
  spectatorMode,
  onChangeSpectatorMode,
  onRegeneratePassword,
  onClose,
  onCopied,
}: InviteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeTab, setActiveTab] = useState<GuestRole>('spectator');
  const [copied, setCopied] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const coPresenterTabId = useId();
  const spectatorTabId = useId();
  const urlInputId = useId();

  const activeUrl = activeTab === 'spectator' ? spectatorUrl : coPresenterUrl;

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
    setCopied(false);
    setCopiedPassword(false);
  }, [activeTab, open]);

  useEffect(() => {
    if (!open || !qrCanvasRef.current) return;
    void QRCode.toCanvas(qrCanvasRef.current, activeUrl, {
      width: 132,
      margin: 1,
      color: {
        dark: '#101214',
        light: '#FFFFFF',
      },
    });
  }, [open, activeUrl]);

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

  // keyboard navigation fallback when native focusgroup="tablist" isn't supported
  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ('focusGroup' in HTMLElement.prototype) return;
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
    );
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex === -1 || tabs.length === 0) return;

    const rtl =
      tablistRef.current && getComputedStyle(tablistRef.current).direction === 'rtl';
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + (rtl ? -1 : 1) + tabs.length) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex + (rtl ? 1 : -1) + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const targetTab = tabs[nextIndex];
      targetTab.focus();
      const role = targetTab.dataset.role as GuestRole | undefined;
      if (role) setActiveTab(role);
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(activeUrl);
    if (ok) {
      setCopied(true);
      onCopied(
        activeTab === 'spectator'
          ? 'Link de espectador copiado.'
          : 'Link de coapresentador copiado.'
      );
      window.setTimeout(() => setCopied(false), 2200);
    } else {
      onCopied(
        'Não foi possível copiar automaticamente. Selecione o link manualmente.'
      );
    }
  };

  const handleCopyPassword = async () => {
    if (!coPresenterPassword) return;
    const ok = await copyToClipboard(coPresenterPassword);
    if (ok) {
      setCopiedPassword(true);
      onCopied('Senha de coapresentador copiada.');
      window.setTimeout(() => setCopiedPassword(false), 2200);
    } else {
      onCopied('Não foi possível copiar a senha automaticamente.');
    }
  };

  const handleShare = async () => {
    await shareInviteLink(activeUrl, roomCode, activeTab);
  };

  const supportsFocusGroup =
    typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

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
          Compartilhar sala
        </h1>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Fechar janela de compartilhamento"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="modal-body">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Tipo de acesso à sala"
          className="invite-tablist"
          onKeyDown={handleTabListKeyDown}
          {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
        >
          <button
            type="button"
            id={spectatorTabId}
            role="tab"
            data-role="spectator"
            className="invite-tab"
            aria-selected={activeTab === 'spectator'}
            tabIndex={supportsFocusGroup || activeTab === 'spectator' ? 0 : -1}
            onClick={() => setActiveTab('spectator')}
            {...(activeTab === 'spectator'
              ? ({ focusgroupstart: '' } as Record<string, string>)
              : {})}
          >
            <Eye size={15} aria-hidden="true" />
            <span>Espectador</span>
          </button>

          <button
            type="button"
            id={coPresenterTabId}
            role="tab"
            data-role="co-presenter"
            className="invite-tab"
            aria-selected={activeTab === 'co-presenter'}
            tabIndex={supportsFocusGroup || activeTab === 'co-presenter' ? 0 : -1}
            onClick={() => setActiveTab('co-presenter')}
            {...(activeTab === 'co-presenter'
              ? ({ focusgroupstart: '' } as Record<string, string>)
              : {})}
          >
            <Users size={15} aria-hidden="true" />
            <span>Coapresentador</span>
          </button>
        </div>

        <div
          role="tabpanel"
          aria-labelledby={
            activeTab === 'spectator' ? spectatorTabId : coPresenterTabId
          }
          className="invite-tabpanel"
        >
          <div className="qr-block">
            <canvas
              ref={qrCanvasRef}
              className="qr-canvas"
              width={132}
              height={132}
              aria-label={
                activeTab === 'spectator'
                  ? `Código QR de visualização da sala ${roomCode}`
                  : `Código QR de coapresentação da sala ${roomCode}`
              }
            />
            <div>
              <p className="join-label">
                {activeTab === 'spectator' ? 'Acesso apenas leitura' : 'Código da sala'}
              </p>
              <p className="room-code-display" translate="no">
                {roomCode}
              </p>
              <p className="ephemeral-note">
                {activeTab === 'spectator'
                  ? 'Quem abrir este link só visualiza e não altera os slides da sala.'
                  : 'Escaneie pelo celular ou envie o link para controlar os slides junto com você.'}
              </p>
            </div>
          </div>

          {activeTab === 'co-presenter' && coPresenterPassword && (
            <div className="join-bar">
              <span className="join-label">Senha de coapresentador</span>
              <div className="password-share-row">
                <div className="password-code-box">
                  <KeyRound size={15} aria-hidden="true" />
                  <span className="password-code-display" translate="no">
                    {coPresenterPassword}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-surface btn-compact"
                  onClick={handleCopyPassword}
                >
                  {copiedPassword ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Copy size={15} aria-hidden="true" />
                  )}
                  <span>{copiedPassword ? 'Copiada' : 'Copiar'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Gerar nova senha de coapresentador"
                  title="Gerar nova senha"
                  onClick={onRegeneratePassword}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'spectator' && (
            <fieldset className="spectator-mode-fieldset">
              <legend className="join-label">Navegação dos espectadores</legend>
              <div className="spectator-mode-options">
                <label
                  className="spectator-mode-option"
                  data-selected={spectatorMode === 'follow'}
                >
                  <input
                    type="radio"
                    name="spectator-mode"
                    value="follow"
                    checked={spectatorMode === 'follow'}
                    onChange={() => onChangeSpectatorMode('follow')}
                  />
                  <span className="spectator-mode-copy">
                    <span className="spectator-mode-title">Acompanhar anfitrião</span>
                    <span className="spectator-mode-desc">
                      Obrigatório seguir sempre o slide atual da apresentação.
                    </span>
                  </span>
                </label>

                <label
                  className="spectator-mode-option"
                  data-selected={spectatorMode === 'free'}
                >
                  <input
                    type="radio"
                    name="spectator-mode"
                    value="free"
                    checked={spectatorMode === 'free'}
                    onChange={() => onChangeSpectatorMode('free')}
                  />
                  <span className="spectator-mode-copy">
                    <span className="spectator-mode-title">Navegação livre</span>
                    <span className="spectator-mode-desc">
                      Pode ver todos os slides e voltar ao seu slide quando quiser.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          <div className="join-bar">
            <label htmlFor={urlInputId} className="join-label">
              {activeTab === 'spectator'
                ? 'Link para espectadores (somente visualização)'
                : 'Link de coapresentação'}
            </label>
            <div className="link-copy-row">
              <input
                id={urlInputId}
                type="text"
                readOnly
                value={activeUrl}
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
            Sem login e sem nuvem: o PDF é enviado direto do seu navegador e o link deixa
            de funcionar assim que você encerrar ou fechar esta aba.
          </p>
        </div>
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
