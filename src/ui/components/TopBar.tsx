import { useEffect, useId, useRef } from 'react';
import { FileUp, LogOut, Moon, MoreVertical, Power, Share2, Sun } from 'lucide-react';
import { canPerformAction, type ParticipantRole } from '@/domain/protocol';
import type { SessionStatus } from '@/domain/session';
import { useColorScheme } from '@/application/useColorScheme';
import { BrandMark } from './BrandMark';
import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
  role: ParticipantRole;
  status: SessionStatus;
  fileName: string | null;
  connectedPeers: number;
  onReplaceFile: (file: File) => void;
  onOpenInvite: () => void;
  onRequestExit: () => void;
}

export function TopBar({
  role,
  status,
  fileName,
  connectedPeers,
  onReplaceFile,
  onOpenInvite,
  onRequestExit,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuPopoverRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const { resolvedScheme, toggleScheme } = useColorScheme();

  const canReplaceDoc = canPerformAction(role, 'replace_document');
  const canInvite = canPerformAction(role, 'invite_copresenter');
  const isHost = role === 'host';
  const isDark = resolvedScheme === 'dark';

  const connectionLabel = isHost
    ? connectedPeers === 0
      ? 'Aguardando coapresentador'
      : connectedPeers === 1
        ? '1 coapresentador'
        : `${connectedPeers} coapresentadores`
    : status === 'synced'
      ? 'Sincronizado'
      : status === 'transferring'
        ? 'Recebendo PDF…'
        : status === 'reconnecting'
          ? 'Reconectando…'
          : 'Conectando…';

  const shortStatusLabel = isHost
    ? connectedPeers === 0
      ? 'Aguardando'
      : connectedPeers === 1
        ? '1 conectado'
        : `${connectedPeers} conectados`
    : connectionLabel;

  const isLive = isHost ? connectedPeers > 0 : status === 'synced';

  // position overflow menu below its trigger when CSS anchor positioning isn't available
  useEffect(() => {
    const menu = menuPopoverRef.current;
    const trigger = menuTriggerRef.current;
    if (!menu || !trigger) return;

    const onToggle = (e: Event) => {
      const toggleEvent = e as ToggleEvent;
      trigger.setAttribute(
        'aria-expanded',
        toggleEvent.newState === 'open' ? 'true' : 'false'
      );
      if (
        toggleEvent.newState !== 'open' ||
        CSS.supports('position-area', 'block-end')
      ) {
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const top = Math.min(
        triggerRect.bottom + 8,
        window.innerHeight - menuRect.height - 12
      );
      const left = Math.max(
        12,
        Math.min(
          triggerRect.right - menuRect.width,
          window.innerWidth - menuRect.width - 12
        )
      );
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    };

    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, []);

  const closeMenu = () => {
    const menu = menuPopoverRef.current as
      (HTMLDivElement & { hidePopover?: () => void }) | null;
    menu?.hidePopover?.();
  };

  return (
    <header className="topbar">
      {canReplaceDoc && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="Selecionar novo arquivo PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onReplaceFile(file);
            e.target.value = '';
          }}
        />
      )}

      <div className="topbar-left">
        <BrandMark compactOnMobile />

        <span className="topbar-divider topbar-desktop-only" aria-hidden="true" />

        <div className="topbar-doc">
          <div className="topbar-doc-meta">
            <span className="topbar-filename" title={fileName ?? undefined}>
              {fileName ?? 'Sem documento'}
            </span>
            <span className="topbar-mobile-status" aria-hidden="true">
              <span className="status-dot" data-live={isLive} />
              <span>{shortStatusLabel}</span>
            </span>
          </div>

          {canReplaceDoc && (
            <button
              type="button"
              className="btn btn-surface btn-compact topbar-desktop-only"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Trocar PDF"
              title="Trocar PDF da apresentação"
            >
              <FileUp size={15} aria-hidden="true" />
              <span>Trocar PDF</span>
            </button>
          )}
        </div>
      </div>

      <div className="topbar-center topbar-desktop-only">
        <span className="status-chip" aria-live="polite" title={connectionLabel}>
          <span className="status-dot" data-live={isLive} aria-hidden="true" />
          <span>{connectionLabel}</span>
        </span>
      </div>

      <div className="topbar-right">
        {canInvite && (
          <button
            type="button"
            className="btn btn-primary topbar-invite-btn"
            onClick={onOpenInvite}
            aria-label="Convidar coapresentador"
          >
            <Share2 size={16} aria-hidden="true" />
            <span>Convidar</span>
          </button>
        )}

        <div className="topbar-desktop-actions">
          <ThemeToggle />

          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={onRequestExit}
            aria-label={isHost ? 'Encerrar sala' : 'Sair da sala'}
            title={isHost ? 'Encerrar apresentação' : 'Sair da sala'}
          >
            {isHost ? (
              <Power size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            <span>{isHost ? 'Encerrar' : 'Sair'}</span>
          </button>
        </div>

        <button
          ref={menuTriggerRef}
          type="button"
          className="btn btn-surface btn-icon topbar-mobile-only topbar-more-trigger"
          aria-label="Mais opções da sala"
          aria-haspopup="menu"
          aria-expanded="false"
          popoverTarget={menuId}
        >
          <MoreVertical size={18} aria-hidden="true" />
        </button>

        <div
          ref={menuPopoverRef}
          id={menuId}
          popover="auto"
          className="topbar-overflow-menu"
          aria-label="Opções da sala"
        >
          {canReplaceDoc && (
            <button
              type="button"
              className="overflow-menu-item"
              onClick={() => {
                closeMenu();
                fileInputRef.current?.click();
              }}
            >
              <FileUp size={16} aria-hidden="true" />
              <span>Trocar PDF</span>
            </button>
          )}

          <button
            type="button"
            className="overflow-menu-item"
            onClick={() => {
              toggleScheme();
              closeMenu();
            }}
          >
            {isDark ? (
              <Sun size={16} aria-hidden="true" />
            ) : (
              <Moon size={16} aria-hidden="true" />
            )}
            <span>{isDark ? 'Tema claro' : 'Tema escuro'}</span>
          </button>

          <hr className="overflow-menu-divider" />

          <button
            type="button"
            className="overflow-menu-item overflow-menu-danger"
            onClick={() => {
              closeMenu();
              onRequestExit();
            }}
          >
            {isHost ? (
              <Power size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            <span>{isHost ? 'Encerrar sala' : 'Sair da sala'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
