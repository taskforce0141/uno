import { useEffect, useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { GameProvider } from './context/GameContext';
import { useAuth } from './hooks/useAuth';
import { useGame } from './hooks/useGame';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ToastContainer } from './components/ui/ToastContainer';
import { AppRoute, TopNav } from './components/layout/TopNav';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { CreateRoom } from './pages/CreateRoom';
import { JoinRoom } from './pages/JoinRoom';
import { Lobby } from './pages/Lobby';
import { Game } from './pages/Game';
import { Results } from './pages/Results';
import { Settings } from './pages/Settings';
import { HowToPlay } from './pages/HowToPlay';
import { extractLobbyRoomIdFromPath, extractRoomCodeFromPath } from './utils/roomUtils';

function AppShell() {
  const { user, authReady } = useAuth();
  const { room, gameState, toasts, addToast, dismissToast, reconnectToRoom } = useGame();

  const [inviteCode, setInviteCode] = useState<string | null>(() =>
    extractRoomCodeFromPath(window.location.pathname)
  );
  const [route, setRoute] = useState<AppRoute>(() => {
    if (extractRoomCodeFromPath(window.location.pathname)) return 'join';
    if (extractLobbyRoomIdFromPath(window.location.pathname)) return 'lobby';
    return 'home';
  });
  const [restoringRoom, setRestoringRoom] = useState<boolean>(() =>
    Boolean(extractLobbyRoomIdFromPath(window.location.pathname))
  );

  // Restore active room after page reload (from /lobby/:roomId URL or sessionStorage)
  useEffect(() => {
    if (!authReady || !user || room) {
      if (authReady && !user && restoringRoom) {
        setRestoringRoom(false);
      }
      return;
    }

    const urlRoomId = extractLobbyRoomIdFromPath(window.location.pathname);
    let savedRoomId: string | null = null;
    try {
      savedRoomId = sessionStorage.getItem('uno_arena_active_room');
    } catch {
      // ignore
    }

    const targetRoomId = urlRoomId || savedRoomId;
    if (!targetRoomId) {
      setRestoringRoom(false);
      return;
    }

    let cancelled = false;
    setRestoringRoom(true);
    reconnectToRoom(targetRoomId)
      .catch((err) => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem('uno_arena_active_room');
        } catch {
          // ignore
        }
        if (urlRoomId) {
          addToast(
            err instanceof Error ? err.message : 'Private room not found or expired.',
            'error'
          );
          window.history.replaceState({}, '', '/');
          setRoute('home');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestoringRoom(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, user, room, reconnectToRoom, addToast]);

  // Automatic state-driven routing when inside an active room
  useEffect(() => {
    if (!room) return;
    if (gameState) {
      if (gameState.gameStatus === 'finished' || gameState.gameStatus === 'round_over') {
        setRoute('results');
      } else if (gameState.gameStatus === 'playing') {
        setRoute('game');
      }
    } else if (room.status === 'waiting' || room.status === 'lobby') {
      if (route === 'game' || route === 'results' || route === 'create' || route === 'join') {
        setRoute('lobby');
      }
      const expectedPath = `/lobby/${encodeURIComponent(room.roomId)}`;
      if (window.location.pathname !== expectedPath) {
        window.history.replaceState({}, '', expectedPath);
      }
    }
  }, [room, gameState?.gameStatus, route]);

  const navigate = (next: AppRoute, roomIdOverride?: string) => {
    if (next === 'lobby') {
      const targetId = roomIdOverride || room?.roomId;
      if (targetId) {
        const lobbyPath = `/lobby/${encodeURIComponent(targetId)}`;
        if (window.location.pathname !== lobbyPath) {
          window.history.pushState({}, '', lobbyPath);
        }
      }
    } else if (
      next !== 'join' &&
      (window.location.pathname.startsWith('/room/') ||
        window.location.pathname.startsWith('/lobby/'))
    ) {
      window.history.replaceState({}, '', '/');
    }
    setRoute(next);
  };

  if (!authReady || restoringRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B1120]">
        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          {restoringRoom ? 'Loading private room lobby...' : 'Loading UNO ARENA...'}
        </div>
      </div>
    );
  }

  const hideTopNav = route === 'game' && Boolean(room && gameState?.gameStatus === 'playing');

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      {!hideTopNav && (
        <TopNav currentRoute={route} onNavigate={navigate} inRoom={Boolean(room)} />
      )}

      <main className="flex-1">
        {route === 'home' && (
          <Home onNavigate={navigate} activeRoomCode={room?.roomCode || null} />
        )}
        {route === 'login' && (
          <Login
            pendingRoomCode={inviteCode}
            onSuccess={() => navigate(inviteCode ? 'join' : 'home')}
          />
        )}
        {route === 'create' && (
          <CreateRoom
            onRoomCreated={(roomId) => navigate('lobby', roomId)}
            onNeedAuth={() => navigate('login')}
          />
        )}
        {route === 'join' && (
          <JoinRoom
            initialCode={inviteCode}
            onJoined={(roomId) => {
              setInviteCode(null);
              navigate('lobby', roomId);
            }}
          />
        )}
        {route === 'lobby' &&
          (room ? (
            <Lobby onLeft={() => navigate('home')} />
          ) : (
            <Home onNavigate={navigate} />
          ))}
        {route === 'game' &&
          (room && gameState ? (
            <Game onLeave={() => navigate('home')} />
          ) : (
            <Home onNavigate={navigate} />
          ))}
        {route === 'results' &&
          (room && gameState ? (
            <Results onLeft={() => navigate('home')} />
          ) : (
            <Home onNavigate={navigate} />
          ))}
        {route === 'settings' && <Settings onGoLogin={() => navigate('login')} />}
        {route === 'how-to-play' && <HowToPlay onNavigate={navigate} />}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <GameProvider>
          <AppShell />
        </GameProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
