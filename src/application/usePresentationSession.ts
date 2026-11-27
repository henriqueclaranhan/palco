import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParticipantRole, SpectatorMode } from '@/domain/protocol';
import { createInitialSessionState, type SessionState } from '@/domain/session';
import { PdfEngine } from '@/infrastructure/pdfEngine';
import { acquireWakeLock } from '@/infrastructure/browserApis';
import { HostSessionController } from './session/hostSessionController';
import { GuestSessionController } from './session/guestSessionController';
import type {
  PasswordRequest,
  RoomAuthRequest,
  SessionController,
  SessionStore,
} from './session/types';

export type { PasswordRequest, RoomAuthRequest } from './session/types';

export interface UsePresentationSessionOptions {
  role: ParticipantRole;
  roomCode: string;
  initialFile?: File | null;
  onNotice?: (message: string) => void;
}

export function usePresentationSession({
  role,
  roomCode,
  initialFile,
  onNotice,
}: UsePresentationSessionOptions) {
  const [state, setState] = useState<SessionState>(() =>
    createInitialSessionState(role, roomCode)
  );
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [roomAuthRequest, setRoomAuthRequest] = useState<RoomAuthRequest | null>(null);

  const engineRef = useRef<PdfEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PdfEngine();
  }

  const stateRef = useRef(state);
  stateRef.current = state;

  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const controllerRef = useRef<SessionController | null>(null);

  useEffect(() => acquireWakeLock(), []);

  useEffect(() => {
    const store: SessionStore = {
      getState: () => stateRef.current,
      updateState: (updater) => {
        setState((prev) => {
          const next = updater(prev);
          stateRef.current = next;
          return next;
        });
      },
      setPasswordRequest,
      setRoomAuthRequest,
      notify: (message) => noticeRef.current?.(message),
    };

    const engine = engineRef.current!;
    const controller: SessionController =
      role === 'host'
        ? new HostSessionController({ roomCode, initialFile, engine, store })
        : new GuestSessionController({ roomCode, role, engine, store });

    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [role, roomCode, initialFile]);

  const loadHostFile = useCallback(
    (file: File) => controllerRef.current?.loadHostFile(file) ?? Promise.resolve(),
    []
  );

  const submitPdfPassword = useCallback(
    (password: string) =>
      controllerRef.current?.submitPdfPassword(password) ?? Promise.resolve(),
    []
  );

  const cancelPdfPassword = useCallback(() => {
    controllerRef.current?.cancelPdfPassword();
  }, []);

  const submitCoPresenterPassword = useCallback((password: string) => {
    controllerRef.current?.submitCoPresenterPassword(password);
  }, []);

  const cancelCoPresenterAuth = useCallback(() => {
    controllerRef.current?.cancelCoPresenterAuth();
  }, []);

  const regenerateCoPresenterPassword = useCallback(() => {
    controllerRef.current?.regenerateCoPresenterPassword();
  }, []);

  const nextPage = useCallback(() => {
    controllerRef.current?.navigate('next');
  }, []);

  const prevPage = useCallback(() => {
    controllerRef.current?.navigate('prev');
  }, []);

  const goToPage = useCallback((page: number) => {
    controllerRef.current?.navigate('goto', page);
  }, []);

  const endSession = useCallback(() => {
    controllerRef.current?.endSession();
  }, []);

  const setSpectatorMode = useCallback((mode: SpectatorMode) => {
    controllerRef.current?.setSpectatorMode(mode);
  }, []);

  const followHost = useCallback(() => {
    controllerRef.current?.followHost();
  }, []);

  return {
    state,
    engine: engineRef.current,
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
  };
}
