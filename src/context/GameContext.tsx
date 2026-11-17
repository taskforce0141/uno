import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { CardColor, PublicGameState, RoomData, UnoCard } from '../engine/gameTypes';
import { createGameWebSocket, SocketMessage } from '../services/gameService';
import {
  closeRoom,
  fetchRoomState,
  kickPlayerFromRoom,
  leaveRoom,
  restartRoomGame,
  returnRoomToLobby,
  startNextRound,
  startRoomGame,
  updatePlayerLobbyState,
  updateRoomSettings,
} from '../services/roomService';
import { useAuth } from '../hooks/useAuth';
import { soundFx } from '../utils/soundFx';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface GameContextValue {
  room: RoomData | null;
  gameState: PublicGameState | null;
  hand: UnoCard[];
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  toasts: ToastItem[];
  addToast: (message: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;
  attachRoom: (room: RoomData, gameState?: PublicGameState | null, hand?: UnoCard[]) => void;
  clearRoom: () => void;
  reconnectToRoom: (roomId: string) => Promise<void>;
  sendGameAction: (actionType: string, payload?: Record<string, unknown>) => void;
  playCards: (cardIds: string[], chosenColor?: CardColor) => void;
  drawCard: () => void;
  chooseColor: (color: CardColor) => void;
  swapHands: (targetPlayerId: string) => void;
  challengeWild4: (challenge: boolean) => void;
  callUno: () => void;
  catchUno: (targetPlayerId: string) => void;
  passTurn: () => void;
  updateLobbyPlayer: (updates: { username?: string; avatar?: string; isReady?: boolean }) => Promise<void>;
  updateSettings: (settings: Parameters<typeof updateRoomSettings>[2]) => Promise<void>;
  kickPlayer: (playerId: string) => Promise<void>;
  leaveCurrentRoom: () => Promise<void>;
  closeCurrentRoom: () => Promise<void>;
  startGame: () => Promise<void>;
  nextRound: () => Promise<void>;
  playAgain: () => Promise<void>;
  backToLobby: () => Promise<void>;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [hand, setHand] = useState<UnoCard[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'reconnecting'
  >('idle');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const socketRef = useRef<ReturnType<typeof createGameWebSocket> | null>(null);
  const prevSeqRef = useRef<number>(0);
  const prevSideRef = useRef<string>('light');
  const prevStatusRef = useRef<string>('');

  const addToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearRoom = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setRoom(null);
    setGameState(null);
    setHand([]);
    setConnectionStatus('idle');
    prevSeqRef.current = 0;
    prevSideRef.current = 'light';
    prevStatusRef.current = '';
    try {
      sessionStorage.removeItem('uno_arena_active_room');
    } catch {
      // ignore
    }
  }, []);

  const handleSocketMessage = useCallback(
    (msg: SocketMessage) => {
      if (msg.type === 'state_sync') {
        setRoom(msg.room);
        setGameState(msg.gameState);
        setHand(msg.hand);

        if (msg.gameState) {
          if (msg.gameState.currentSide !== prevSideRef.current) {
            soundFx.flipSide();
            prevSideRef.current = msg.gameState.currentSide;
          } else if (
            (msg.gameState.gameStatus === 'finished' || msg.gameState.gameStatus === 'round_over') &&
            prevStatusRef.current === 'playing'
          ) {
            soundFx.win();
          } else if (msg.gameState.actionSeq > prevSeqRef.current) {
            const topMsg = msg.gameState.lastAction.toLowerCase();
            if (topMsg.includes('uno!')) soundFx.unoCall();
            else if (topMsg.includes('skip')) soundFx.skip();
            else if (topMsg.includes('reverse')) soundFx.reverse();
            else if (topMsg.includes('drew') || topMsg.includes('draw')) soundFx.drawCard();
            else soundFx.playCard();
          }
          prevSeqRef.current = msg.gameState.actionSeq;
          prevStatusRef.current = msg.gameState.gameStatus;
        }
      } else if (msg.type === 'error') {
        addToast(msg.message, 'error');
      } else if (msg.type === 'kicked' || msg.type === 'room_closed') {
        addToast(msg.message, 'error');
        clearRoom();
      }
    },
    [addToast, clearRoom]
  );

  const activeRoomId = room?.roomId;
  const sessionToken = user?.sessionToken;

  useEffect(() => {
    if (!activeRoomId || !sessionToken) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    socketRef.current?.close();
    socketRef.current = createGameWebSocket(
      activeRoomId,
      sessionToken,
      handleSocketMessage,
      (status) => setConnectionStatus(status)
    );

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [activeRoomId, sessionToken, handleSocketMessage]);

  const attachRoom = useCallback(
    (nextRoom: RoomData, nextGame: PublicGameState | null = null, nextHand: UnoCard[] = []) => {
      if (!nextRoom || !nextRoom.roomId || !nextRoom.roomCode) {
        throw new Error('Cannot attach an invalid or incomplete room object.');
      }
      setRoom(nextRoom);
      setGameState(nextGame);
      setHand(nextHand);
      if (nextGame) {
        prevSeqRef.current = nextGame.actionSeq;
        prevSideRef.current = nextGame.currentSide;
        prevStatusRef.current = nextGame.gameStatus;
      }
      try {
        sessionStorage.setItem('uno_arena_active_room', nextRoom.roomId);
      } catch {
        // ignore
      }
    },
    []
  );

  const reconnectToRoom = useCallback(
    async (roomId: string) => {
      if (!user) return;
      const data = await fetchRoomState(user.sessionToken, roomId);
      if (!data || !data.room || !data.room.roomId) {
        throw new Error('Room state could not be restored.');
      }
      attachRoom(data.room, data.gameState, data.hand);
    },
    [user, attachRoom]
  );

  const sendGameAction = useCallback((actionType: string, payload: Record<string, unknown> = {}) => {
    socketRef.current?.sendAction(actionType, payload);
  }, []);

  const playCards = useCallback(
    (cardIds: string[], chosenColor?: CardColor) => {
      sendGameAction('play_cards', { cardIds, ...(chosenColor ? { chosenColor } : {}) });
    },
    [sendGameAction]
  );

  const drawCard = useCallback(() => sendGameAction('draw_card'), [sendGameAction]);
  const chooseColor = useCallback((color: CardColor) => sendGameAction('choose_color', { color }), [sendGameAction]);
  const swapHands = useCallback(
    (targetPlayerId: string) => sendGameAction('swap_hands', { targetPlayerId }),
    [sendGameAction]
  );
  const challengeWild4 = useCallback(
    (challenge: boolean) => sendGameAction('challenge_wild4', { challenge }),
    [sendGameAction]
  );
  const callUno = useCallback(() => sendGameAction('call_uno'), [sendGameAction]);
  const catchUno = useCallback(
    (targetPlayerId: string) => sendGameAction('catch_uno', { targetPlayerId }),
    [sendGameAction]
  );
  const passTurn = useCallback(() => sendGameAction('pass_turn'), [sendGameAction]);

  const updateLobbyPlayer = useCallback(
    async (updates: { username?: string; avatar?: string; isReady?: boolean }) => {
      if (!user || !room) return;
      const res = await updatePlayerLobbyState(user.sessionToken, room.roomId, updates);
      setRoom(res.room);
    },
    [user, room]
  );

  const updateSettings = useCallback(
    async (settings: Parameters<typeof updateRoomSettings>[2]) => {
      if (!user || !room) return;
      const res = await updateRoomSettings(user.sessionToken, room.roomId, settings);
      setRoom(res.room);
    },
    [user, room]
  );

  const kickPlayer = useCallback(
    async (playerId: string) => {
      if (!user || !room) return;
      const res = await kickPlayerFromRoom(user.sessionToken, room.roomId, playerId);
      setRoom(res.room);
    },
    [user, room]
  );

  const leaveCurrentRoom = useCallback(async () => {
    if (user && room) {
      await leaveRoom(user.sessionToken, room.roomId).catch(() => {});
    }
    clearRoom();
  }, [user, room, clearRoom]);

  const closeCurrentRoom = useCallback(async () => {
    if (user && room) {
      await closeRoom(user.sessionToken, room.roomId).catch(() => {});
    }
    clearRoom();
  }, [user, room, clearRoom]);

  const startGame = useCallback(async () => {
    if (!user || !room) return;
    const res = await startRoomGame(user.sessionToken, room.roomId);
    setRoom(res.room);
    setGameState(res.gameState);
    setHand(res.hand);
  }, [user, room]);

  const nextRound = useCallback(async () => {
    if (!user || !room) return;
    await startNextRound(user.sessionToken, room.roomId);
  }, [user, room]);

  const playAgain = useCallback(async () => {
    if (!user || !room) return;
    await restartRoomGame(user.sessionToken, room.roomId);
  }, [user, room]);

  const backToLobby = useCallback(async () => {
    if (!user || !room) return;
    const res = await returnRoomToLobby(user.sessionToken, room.roomId);
    setRoom(res.room);
    setGameState(null);
    setHand([]);
  }, [user, room]);

  return (
    <GameContext.Provider
      value={{
        room,
        gameState,
        hand,
        connectionStatus,
        toasts,
        addToast,
        dismissToast,
        attachRoom,
        clearRoom,
        reconnectToRoom,
        sendGameAction,
        playCards,
        drawCard,
        chooseColor,
        swapHands,
        challengeWild4,
        callUno,
        catchUno,
        passTurn,
        updateLobbyPlayer,
        updateSettings,
        kickPlayer,
        leaveCurrentRoom,
        closeCurrentRoom,
        startGame,
        nextRound,
        playAgain,
        backToLobby,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
