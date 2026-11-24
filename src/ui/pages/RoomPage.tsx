import { useMemo, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import type { ParticipantRole } from '@/domain/protocol';
import { formatBytes } from '@/domain/session';
import { usePresentationSession } from '@/application/usePresentationSession';
import { useFullscreen } from '@/application/useFullscreen';
import { useKeyboardAndSwipe } from '@/application/useKeyboardAndSwipe';
import { useToasts } from '@/application/useToasts';
import { TopBar } from '@/ui/components/TopBar';
import { PdfStage } from '@/ui/components/PdfStage';
import { StageOverlay } from '@/ui/components/StageOverlay';
import { PresenterToolbar } from '@/ui/components/PresenterToolbar';
import { InviteDialog } from '@/ui/components/InviteDialog';
import { ConfirmDialog } from '@/ui/components/ConfirmDialog';
import { ToastRegion } from '@/ui/components/ToastRegion';

interface RoomPageProps {
  role: ParticipantRole;
  roomCode: string;
  initialFile?: File | null;
  onLeaveToHome: () => void;
}

export function RoomPage({
  role,
  roomCode,
  initialFile,
  onLeaveToHome,
}: RoomPageProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  const { toasts, pushToast, dismissToast } = useToasts();

  const { state, engine, loadHostFile, nextPage, prevPage, goToPage, endSession } =
    usePresentationSession({
      role,
      roomCode,
      initialFile,
      onNotice: pushToast,
    });

  const { isFullscreen, isPseudoFullscreen, toggleFullscreen, exitFullscreen } =
    useFullscreen(shellRef);

  const totalPages = state.document?.totalPages ?? 0;
  const hasRenderableDoc =
    Boolean(state.document) &&
    state.status !== 'ended' &&
    state.status !== 'error' &&
    state.status !== 'connecting' &&
    state.status !== 'reconnecting' &&
    state.status !== 'transferring';

  const { swipeHandlers } = useKeyboardAndSwipe({
    enabled: hasRenderableDoc,
    totalPages,
    onNext: nextPage,
    onPrev: prevPage,
    onFirst: () => goToPage(1),
    onLast: () => goToPage(totalPages),
    onToggleFullscreen: toggleFullscreen,
  });

  const inviteUrl = useMemo(
    () => `${window.location.origin}/s/${roomCode}`,
    [roomCode]
  );

  const handleRequestExit = () => {
    if (role === 'host' && state.status !== 'ended') {
      setConfirmEndOpen(true);
      return;
    }
    void exitFullscreen();
    endSession();
    onLeaveToHome();
  };

  const handleConfirmEndHost = () => {
    setConfirmEndOpen(false);
    void exitFullscreen();
    endSession();
    onLeaveToHome();
  };

  const endConfirmationText = state.document
    ? `O link da sala ${roomCode} será desativado imediatamente para todos os coapresentadores e “${state.document.fileName}” (${formatBytes(state.document.byteLength)}) será removido da memória.`
    : `O link da sala ${roomCode} será desativado imediatamente para todos os coapresentadores.`;

  return (
    <div
      ref={shellRef}
      className="room-shell"
      data-fullscreen={isFullscreen}
      data-pseudo-fullscreen={isPseudoFullscreen}
    >
      {!isFullscreen && (
        <TopBar
          role={role}
          status={state.status}
          fileName={state.document?.fileName ?? null}
          connectedPeers={state.connectedPeers}
          onReplaceFile={(file) => void loadHostFile(file)}
          onOpenInvite={() => setInviteOpen(true)}
          onRequestExit={handleRequestExit}
        />
      )}

      <main id="main-content" className="stage-container">
        {hasRenderableDoc && state.document ? (
          <PdfStage
            engine={engine}
            docId={state.document.docId}
            pageNumber={state.currentPage}
            totalPages={state.document.totalPages}
            onNext={nextPage}
            onPrev={prevPage}
            swipeHandlers={swipeHandlers}
          />
        ) : (
          <StageOverlay
            role={role}
            status={state.status}
            roomCode={roomCode}
            transferProgress={state.transferProgress}
            errorMessage={state.errorMessage}
            onSelectFile={(file) => void loadHostFile(file)}
            onLeaveToHome={onLeaveToHome}
          />
        )}

        {!isFullscreen && hasRenderableDoc && state.document && (
          <PresenterToolbar
            currentPage={state.currentPage}
            totalPages={state.document.totalPages}
            isFullscreen={isFullscreen}
            onPrev={prevPage}
            onNext={nextPage}
            onGoToPage={goToPage}
            onToggleFullscreen={toggleFullscreen}
          />
        )}

        {isPseudoFullscreen && (
          <button
            type="button"
            className="btn btn-surface btn-icon pseudo-fs-exit"
            aria-label="Sair da tela cheia"
            onClick={() => void exitFullscreen()}
          >
            <Minimize2 size={18} aria-hidden="true" />
          </button>
        )}
      </main>

      {role === 'host' && (
        <>
          <InviteDialog
            open={inviteOpen}
            roomCode={roomCode}
            inviteUrl={inviteUrl}
            onClose={() => setInviteOpen(false)}
            onCopied={pushToast}
          />

          <ConfirmDialog
            open={confirmEndOpen}
            title="Encerrar apresentação?"
            description={endConfirmationText}
            confirmLabel="Encerrar sala"
            onCancel={() => setConfirmEndOpen(false)}
            onConfirm={handleConfirmEndHost}
          />
        </>
      )}

      {!isFullscreen && <ToastRegion toasts={toasts} onDismiss={dismissToast} />}
    </div>
  );
}
