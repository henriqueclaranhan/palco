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

const RoomPage = lazy(() =>
  import('@/ui/pages/RoomPage').then((module) => ({ default: module.RoomPage }))
);

type RouteState =
  | { view: 'home' }
  | {
      view: 'room';
      role: ParticipantRole;
      roomCode: string;
      initialFile?: File | null;
    };

function parseInitialRoute(): RouteState {
  const pathMatch = window.location.pathname.match(/^\/s\/([^/]+)\/?$/i);
  const queryCode = new URLSearchParams(window.location.search).get('room');
  const rawCode = pathMatch?.[1] ?? queryCode;

  if (rawCode) {
    const normalized = normalizeRoomCode(rawCode);
    if (isValidRoomCode(normalized)) {
      const role: ParticipantRole = isHostTabForRoom(normalized)
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
    route.view === 'home' ? DEFAULT_DOCUMENT_TITLE : formatRoomTitle(route.roomCode),
    route.view === 'home' ? 'index, follow' : 'noindex, nofollow'
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
  }, []);

  if (route.view === 'home') {
    return <HomePage onStartAsHost={handleStartAsHost} onJoinRoom={handleJoinRoom} />;
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
