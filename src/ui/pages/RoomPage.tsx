import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import type { ParticipantRole } from '@/domain/protocol';
import { formatBytes } from '@/domain/session';
import { usePresentationSession } from '@/application/usePresentationSession';
import { useFullscreen } from '@/application/useFullscreen';
import { useKeyboardAndSwipe } from '@/application/useKeyboardAndSwipe';
import { useToasts } from '@/application/useToasts';
import { formatRoomTitle, useDocumentMeta } from '@/application/useDocumentMeta';
import { TopBar } from '@/ui/components/TopBar';
import { PdfStage } from '@/ui/components/PdfStage';
import { StageOverlay } from '@/ui/components/StageOverlay';
import { SlideFilmstrip } from '@/ui/components/SlideFilmstrip';
import { PresenterToolbar } from '@/ui/components/PresenterToolbar';
import { InviteDialog } from '@/ui/components/InviteDialog';
import { ConfirmDialog } from '@/ui/components/ConfirmDialog';
import { PasswordDialog } from '@/ui/components/PasswordDialog';
import { SlideGridDialog } from '@/ui/components/SlideGridDialog';
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
  const [slideGridOpen, setSlideGridOpen] = useState(false);

  const { toasts, pushToast, dismissToast } = useToasts();

  const {
    state,
    engine,
    passwordRequest,
    loadHostFile,
    submitPdfPassword,
    cancelPdfPassword,
    nextPage,
    prevPage,
    goToPage,
    endSession,
  } = usePresentationSession({
    role,
    roomCode,
    initialFile,
    onNotice: pushToast,
  });

  useDocumentMeta(
    formatRoomTitle(roomCode, state.document?.fileName),
    'noindex, nofollow'
  );

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

  const canOpenSlideGrid = hasRenderableDoc && !passwordRequest && totalPages > 0;

  useEffect(() => {
    if (!canOpenSlideGrid && slideGridOpen) {
      setSlideGridOpen(false);
    }
  }, [canOpenSlideGrid, slideGridOpen]);

  const toggleSlideGrid = useCallback(() => {
    if (!canOpenSlideGrid) return;
    setSlideGridOpen((prev) => !prev);
  }, [canOpenSlideGrid]);

  const { swipeHandlers } = useKeyboardAndSwipe({
    enabled: hasRenderableDoc && !passwordRequest,
    totalPages,
    onNext: nextPage,
    onPrev: prevPage,
    onFirst: () => goToPage(1),
    onLast: () => goToPage(totalPages),
    onToggleFullscreen: toggleFullscreen,
    onToggleSlideGrid: toggleSlideGrid,
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

      {!isFullscreen && hasRenderableDoc && state.document && (
        <div className="room-bottom-dock">
          <SlideFilmstrip
            engine={engine}
            docId={state.document.docId}
            currentPage={state.currentPage}
            totalPages={state.document.totalPages}
            onSelectPage={goToPage}
          />

          <PresenterToolbar
            currentPage={state.currentPage}
            totalPages={state.document.totalPages}
            isFullscreen={isFullscreen}
            isSlideGridOpen={slideGridOpen}
            onPrev={prevPage}
            onNext={nextPage}
            onGoToPage={goToPage}
            onToggleSlideGrid={toggleSlideGrid}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      )}

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

      <PasswordDialog
        open={Boolean(passwordRequest)}
        fileName={passwordRequest?.fileName ?? ''}
        errorMessage={passwordRequest?.errorMessage ?? null}
        submitting={passwordRequest?.submitting ?? false}
        onSubmit={(password) => void submitPdfPassword(password)}
        onCancel={cancelPdfPassword}
      />

      {state.document && (
        <SlideGridDialog
          open={slideGridOpen && canOpenSlideGrid}
          engine={engine}
          docId={state.document.docId}
          currentPage={state.currentPage}
          totalPages={state.document.totalPages}
          onSelectPage={goToPage}
          onClose={() => setSlideGridOpen(false)}
        />
      )}

      {!isFullscreen && <ToastRegion toasts={toasts} onDismiss={dismissToast} />}
    </div>
  );
}
