import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minimize2, Radio } from 'lucide-react';
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
    roomAuthRequest,
    loadHostFile,
    submitPdfPassword,
    cancelPdfPassword,
    submitCoPresenterPassword,
    cancelCoPresenterAuth,
    regenerateCoPresenterPassword,
    nextPage,
    prevPage,
    goToPage,
    endSession,
    setSpectatorMode,
    followHost,
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

  const isSpectator = role === 'spectator';
  const canNavigate = !isSpectator || state.spectatorMode === 'free';
  const totalPages = state.document?.totalPages ?? 0;
  const hasRenderableDoc =
    Boolean(state.document) &&
    state.status !== 'ended' &&
    state.status !== 'error' &&
    state.status !== 'connecting' &&
    state.status !== 'authenticating' &&
    state.status !== 'reconnecting' &&
    state.status !== 'transferring';

  const canOpenSlideGrid =
    hasRenderableDoc &&
    !passwordRequest &&
    !roomAuthRequest &&
    totalPages > 0 &&
    canNavigate;

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
    enabled: hasRenderableDoc && !passwordRequest && !roomAuthRequest,
    canNavigate,
    totalPages,
    onNext: nextPage,
    onPrev: prevPage,
    onFirst: () => goToPage(1),
    onLast: () => goToPage(totalPages),
    onToggleFullscreen: toggleFullscreen,
    onToggleSlideGrid: toggleSlideGrid,
  });

  const coPresenterUrl = useMemo(
    () => `${window.location.origin}/s/${roomCode}`,
    [roomCode]
  );

  const spectatorUrl = useMemo(
    () => `${window.location.origin}/v/${roomCode}`,
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
    ? `O link da sala ${roomCode} será desativado imediatamente para todos os participantes e “${state.document.fileName}” (${formatBytes(state.document.byteLength)}) será removido da memória.`
    : `O link da sala ${roomCode} será desativado imediatamente para todos os participantes.`;

  const showFullscreenReturnToHost =
    isFullscreen &&
    hasRenderableDoc &&
    isSpectator &&
    canNavigate &&
    !state.isFollowingHost;

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
          connectedCoPresenters={state.connectedCoPresenters}
          connectedSpectators={state.connectedSpectators}
          spectatorMode={state.spectatorMode}
          isFollowingHost={state.isFollowingHost}
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
            canNavigate={canNavigate}
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

        {showFullscreenReturnToHost && (
          <button
            type="button"
            className="btn btn-primary btn-compact spectator-fs-return"
            onClick={followHost}
          >
            <Radio size={15} aria-hidden="true" />
            <span>
              {state.hostPage !== state.currentPage
                ? `Voltar ao anfitrião (slide ${state.hostPage})`
                : 'Acompanhar anfitrião'}
            </span>
          </button>
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
          {canNavigate && (
            <SlideFilmstrip
              engine={engine}
              docId={state.document.docId}
              currentPage={state.currentPage}
              hostPage={isSpectator ? state.hostPage : undefined}
              totalPages={state.document.totalPages}
              onSelectPage={goToPage}
            />
          )}

          <PresenterToolbar
            currentPage={state.currentPage}
            totalPages={state.document.totalPages}
            isFullscreen={isFullscreen}
            isSlideGridOpen={slideGridOpen}
            canNavigate={canNavigate}
            isSpectator={isSpectator}
            isFollowingHost={state.isFollowingHost}
            hostPage={state.hostPage}
            onPrev={prevPage}
            onNext={nextPage}
            onGoToPage={goToPage}
            onFollowHost={followHost}
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
            coPresenterUrl={coPresenterUrl}
            spectatorUrl={spectatorUrl}
            coPresenterPassword={state.coPresenterPassword}
            spectatorMode={state.spectatorMode}
            onChangeSpectatorMode={setSpectatorMode}
            onRegeneratePassword={regenerateCoPresenterPassword}
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
        open={Boolean(roomAuthRequest)}
        fileName={roomAuthRequest?.roomCode ?? roomCode}
        errorMessage={roomAuthRequest?.errorMessage ?? null}
        submitting={roomAuthRequest?.submitting ?? false}
        title="Senha de coapresentador"
        description={
          <>
            A sala <strong translate="no">{roomCode}</strong> exige senha para entrar
            como coapresentador e controlar os slides.
          </>
        }
        label="Senha da sala"
        hint="Peça a senha ao anfitrião na aba Coapresentador da janela de compartilhamento."
        submitLabel="Entrar como coapresentador"
        submittingLabel="Verificando…"
        emptyErrorMessage="Digite a senha de coapresentador."
        cancelAriaLabel="Cancelar entrada como coapresentador"
        onSubmit={submitCoPresenterPassword}
        onCancel={() => {
          cancelCoPresenterAuth();
          onLeaveToHome();
        }}
      />

      <PasswordDialog
        open={Boolean(passwordRequest)}
        fileName={passwordRequest?.fileName ?? ''}
        errorMessage={passwordRequest?.errorMessage ?? null}
        submitting={passwordRequest?.submitting ?? false}
        onSubmit={(password) => void submitPdfPassword(password)}
        onCancel={cancelPdfPassword}
      />

      {state.document && canNavigate && (
        <SlideGridDialog
          open={slideGridOpen && canOpenSlideGrid}
          engine={engine}
          docId={state.document.docId}
          currentPage={state.currentPage}
          hostPage={isSpectator ? state.hostPage : undefined}
          totalPages={state.document.totalPages}
          onSelectPage={goToPage}
          onClose={() => setSlideGridOpen(false)}
        />
      )}

      {!isFullscreen && <ToastRegion toasts={toasts} onDismiss={dismissToast} />}
    </div>
  );
}
