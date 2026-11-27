import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  type ParticipantRole,
} from '@/domain/protocol';
import {
  clearHostReloadState,
  isHostTabForRoom,
} from '@/infrastructure/ephemeralHostStore';
import {
  DEFAULT_DOCUMENT_TITLE,
  formatRoomTitle,
  useDocumentMeta,
} from '@/application/useDocumentMeta';
import { HomePage } from '@/ui/pages/HomePage';
import { PrivacyPage } from '@/ui/pages/PrivacyPage';

const RoomPage = lazy(() =>
  import('@/ui/pages/RoomPage').then((module) => ({ default: module.RoomPage }))
);

type RouteState =
  | { view: 'home' }
  | { view: 'privacy' }
  | {
      view: 'room';
      role: ParticipantRole;
      roomCode: string;
      initialFile?: File | null;
    };

function parseInitialRoute(): RouteState {
  if (/^\/privacidade\/?$/i.test(window.location.pathname)) {
    return { view: 'privacy' };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const spectatorPathMatch = window.location.pathname.match(/^\/v\/([^/]+)\/?$/i);
  if (spectatorPathMatch?.[1]) {
    const normalized = normalizeRoomCode(spectatorPathMatch[1]);
    if (isValidRoomCode(normalized)) {
      return { view: 'room', role: 'spectator', roomCode: normalized };
    }
  }

  const pathMatch = window.location.pathname.match(/^\/s\/([^/]+)\/?$/i);
  const queryCode = searchParams.get('room');
  const rawCode = pathMatch?.[1] ?? queryCode;

  if (rawCode) {
    const normalized = normalizeRoomCode(rawCode);
    if (isValidRoomCode(normalized)) {
      const isSpectatorQuery = searchParams.get('mode') === 'spectator';
      const role: ParticipantRole = isSpectatorQuery
        ? 'spectator'
        : isHostTabForRoom(normalized)
          ? 'host'
          : 'co-presenter';
      return { view: 'room', role, roomCode: normalized };
    }
  }
  return { view: 'home' };
}

export function App() {
  const [route, setRoute] = useState<RouteState>(parseInitialRoute);

  useDocumentMeta(
    route.view === 'home'
      ? DEFAULT_DOCUMENT_TITLE
      : route.view === 'privacy'
        ? 'Privacidade | Palco'
        : formatRoomTitle(route.roomCode),
    route.view === 'room' ? 'noindex, nofollow' : 'index, follow'
  );

  useEffect(() => {
    if (route.view === 'home') {
      clearHostReloadState();
    }
  }, [route.view]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseInitialRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleStartAsHost = useCallback((file: File) => {
    const roomCode = generateRoomCode();
    window.history.pushState(null, '', `/s/${roomCode}`);
    setRoute({ view: 'room', role: 'host', roomCode, initialFile: file });
  }, []);

  const handleJoinRoom = useCallback((roomCode: string) => {
    const normalized = normalizeRoomCode(roomCode);
    window.history.pushState(null, '', `/s/${normalized}`);
    setRoute({ view: 'room', role: 'co-presenter', roomCode: normalized });
  }, []);

  const handleLeaveToHome = useCallback(() => {
    clearHostReloadState();
    window.history.pushState(null, '', '/');
    setRoute({ view: 'home' });
    window.scrollTo({ top: 0 });
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    window.history.pushState(null, '', '/privacidade');
    setRoute({ view: 'privacy' });
    window.scrollTo({ top: 0 });
  }, []);

  if (route.view === 'home') {
    return (
      <HomePage
        onStartAsHost={handleStartAsHost}
        onJoinRoom={handleJoinRoom}
        onOpenPrivacy={handleOpenPrivacy}
      />
    );
  }

  if (route.view === 'privacy') {
    return <PrivacyPage onNavigateHome={handleLeaveToHome} />;
  }

  return (
    <Suspense
      fallback={
        <div className="room-shell">
          <main id="main-content" className="stage-container" aria-busy="true" />
        </div>
      }
    >
      <RoomPage
        key={`${route.role}-${route.roomCode}`}
        role={route.role}
        roomCode={route.roomCode}
        initialFile={route.initialFile}
        onLeaveToHome={handleLeaveToHome}
      />
    </Suspense>
  );
}
