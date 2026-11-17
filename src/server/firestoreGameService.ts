import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  CardColor,
  CustomRulesConfig,
  GameMode,
  PlayerRecord,
  PublicGameState,
  RoomData,
  ServerGameState,
  UnoCard,
} from '../engine/gameTypes.ts';
import { resolveRulesForMode } from '../engine/customRules.ts';
import { shuffleCards } from '../engine/deck.ts';
import {
  callUnoAction,
  catchUnoAction,
  challengeWild4Action,
  chooseColorAction,
  createInitialGameState,
  drawCardAction,
  GameEngineError,
  handleTurnTimeout,
  passTurnAction,
  playCardsAction,
  startNextRoundAction,
  swapHandsAction,
  toPublicGameState,
} from '../engine/gameEngine.ts';
import { ApiHttpError, getFirebaseAdmin } from './firebaseAdmin.ts';

function toMillis(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function isValidDocId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(id)
  );
}

function docToRoomData(
  roomId: string,
  d: Record<string, unknown>,
  players: PlayerRecord[]
): RoomData {
  const gameMode: GameMode = ['classic', 'flip', 'custom'].includes(String(d.gameMode))
    ? (d.gameMode as GameMode)
    : 'classic';

  return {
    roomId: String(d.roomId || roomId),
    roomCode: String(d.roomCode || ''),
    roomName: String(d.roomName || 'UNO Arena Room'),
    hostId: String(d.hostId || ''),
    privacy: 'private',
    gameMode,
    maxPlayers: Math.min(10, Math.max(2, Number(d.maxPlayers || 10))),
    status: (['waiting', 'lobby', 'playing', 'finished', 'closed'].includes(String(d.status))
      ? d.status
      : 'waiting') as RoomData['status'],
    customRules: resolveRulesForMode(
      gameMode,
      (d.customRules as Partial<CustomRulesConfig>) || {}
    ),
    players,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
  };
}

function docToPlayerRecord(docId: string, p: Record<string, unknown>): PlayerRecord {
  return {
    id: String(p.playerId || docId),
    username: String(p.username || 'Player'),
    avatar: String(p.avatar || 'crimson'),
    isHost: Boolean(p.isHost),
    isReady: Boolean(p.isReady),
    isSpectator: false,
    connectionStatus:
      p.connectionStatus === 'reconnecting' || p.connectionStatus === 'offline'
        ? p.connectionStatus
        : 'online',
    joinedAt: toMillis(p.joinedAt),
    lastSeen: toMillis(p.lastSeen),
  };
}

function serializePublicState(state: ServerGameState): PublicGameState {
  const pub = toPublicGameState(state);
  return JSON.parse(JSON.stringify(pub)) as PublicGameState;
}

function serializeSecretState(state: ServerGameState): ServerGameState {
  return JSON.parse(JSON.stringify(state)) as ServerGameState;
}

async function recordMatchStats(
  winnerId: string | null,
  players: PlayerRecord[]
): Promise<void> {
  const { adminDb } = getFirebaseAdmin();
  const active = players.filter((p) => !p.isSpectator);
  await Promise.all(
    active.map((p) =>
      adminDb
        .collection('users')
        .doc(p.id)
        .update({
          gamesPlayed: FieldValue.increment(1),
          ...(winnerId === p.id ? { wins: FieldValue.increment(1) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => {})
    )
  );
}

export interface MatchActionResult {
  room: RoomData;
  gameState: PublicGameState | null;
  hand: UnoCard[];
}

export async function startMatchInFirestore(
  uid: string,
  roomId: string
): Promise<MatchActionResult> {
  if (!isValidDocId(roomId)) {
    throw new ApiHttpError(400, 'Invalid roomId.');
  }

  const { adminDb } = getFirebaseAdmin();
  const roomRef = adminDb.collection('rooms').doc(roomId);
  const stateRef = roomRef.collection('game').doc('state');
  const secretRef = roomRef.collection('secret').doc('state');

  let result!: MatchActionResult;

  await adminDb.runTransaction(async (tx) => {
    const [roomSnap, playersSnap, secretSnap] = await Promise.all([
      tx.get(roomRef),
      tx.get(roomRef.collection('players').orderBy('joinedAt', 'asc')),
      tx.get(secretRef),
    ]);

    if (!roomSnap.exists) {
      throw new ApiHttpError(404, 'Private room not found.');
    }

    const roomRaw = roomSnap.data()!;
    if (roomRaw.status === 'closed') {
      throw new ApiHttpError(400, 'This private room has been closed.');
    }
    if (roomRaw.hostId !== uid) {
      throw new ApiHttpError(403, 'Only the room host can start the game.');
    }
    if (roomRaw.status !== 'waiting' && roomRaw.status !== 'lobby') {
      throw new ApiHttpError(409, 'This match has already started.');
    }
    if (secretSnap.exists && secretSnap.data()?.gameStatus === 'playing') {
      throw new ApiHttpError(409, 'Game has already been initialized.');
    }

    const players = playersSnap.docs.map((d) => docToPlayerRecord(d.id, d.data()));
    const activePlayers = players.filter((p) => !p.isSpectator);
    if (activePlayers.length < 2) {
      throw new ApiHttpError(400, 'At least 2 players are required to start a match.');
    }
    if (activePlayers.length > 10 || activePlayers.length > Number(roomRaw.maxPlayers || 10)) {
      throw new ApiHttpError(400, 'Player count exceeds maximum room capacity.');
    }

    const gameMode: GameMode = ['classic', 'flip', 'custom'].includes(String(roomRaw.gameMode))
      ? (roomRaw.gameMode as GameMode)
      : 'classic';

    let gameState: ServerGameState;
    try {
      gameState = createInitialGameState(
        roomId,
        gameMode,
        roomRaw.customRules as Partial<CustomRulesConfig>,
        players
      );
    } catch (err) {
      if (err instanceof GameEngineError) {
        throw new ApiHttpError(400, err.message);
      }
      throw err;
    }

    const now = FieldValue.serverTimestamp();
    const publicState = serializePublicState(gameState);
    const secretState = serializeSecretState(gameState);

    tx.update(roomRef, {
      status: 'playing',
      updatedAt: now,
    });
    tx.set(secretRef, {
      ...secretState,
      updatedAt: now,
    });
    tx.set(stateRef, {
      ...publicState,
      updatedAt: now,
    });

    for (const p of players) {
      const pHand = gameState.hands[p.id] ?? [];
      tx.set(roomRef.collection('hands').doc(p.id), {
        playerId: p.id,
        cards: pHand,
        updatedAt: now,
      });
      tx.update(roomRef.collection('players').doc(p.id), {
        cardCount: pHand.length,
        lastSeen: now,
      });
    }

    const roomData = docToRoomData(roomId, { ...roomRaw, status: 'playing' }, players);
    result = {
      room: roomData,
      gameState: publicState,
      hand: gameState.hands[uid] ?? [],
    };
  });

  return result;
}

export type ServerGameActionType =
  | 'play_cards'
  | 'draw_card'
  | 'choose_color'
  | 'swap_hands'
  | 'challenge_wild4'
  | 'call_uno'
  | 'catch_uno'
  | 'pass_turn'
  | 'timeout'
  | 'next_round'
  | 'restart'
  | 'return_lobby'
  | 'leave';

export async function executeMatchActionInFirestore(
  uid: string,
  roomId: string,
  actionType: ServerGameActionType,
  payload: Record<string, unknown> = {}
): Promise<MatchActionResult> {
  if (!isValidDocId(roomId)) {
    throw new ApiHttpError(400, 'Invalid roomId.');
  }

  const rawActionId =
    typeof payload.actionId === 'string' && isValidDocId(payload.actionId)
      ? payload.actionId
      : `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { adminDb } = getFirebaseAdmin();
  const roomRef = adminDb.collection('rooms').doc(roomId);
  const stateRef = roomRef.collection('game').doc('state');
  const secretRef = roomRef.collection('secret').doc('state');
  const actionRef = roomRef.collection('actions').doc(rawActionId);

  let result!: MatchActionResult;
  let matchJustFinishedWinner: string | null = null;
  let playersForStats: PlayerRecord[] = [];

  await adminDb.runTransaction(async (tx) => {
    const [existingActionSnap, roomSnap, secretSnap, playersSnap] = await Promise.all([
      tx.get(actionRef),
      tx.get(roomRef),
      tx.get(secretRef),
      tx.get(roomRef.collection('players').orderBy('joinedAt', 'asc')),
    ]);

    if (!roomSnap.exists) {
      throw new ApiHttpError(404, 'Private room not found.');
    }

    const roomRaw = roomSnap.data()!;
    const players = playersSnap.docs.map((d) => docToPlayerRecord(d.id, d.data()));
    const roomData = docToRoomData(roomId, roomRaw, players);

    const isMember = players.some((p) => p.id === uid);
    if (!isMember && roomRaw.hostId !== uid) {
      throw new ApiHttpError(403, 'You are not a member of this private room.');
    }

    // Idempotency: if this actionId was already applied, return current state
    if (existingActionSnap.exists && secretSnap.exists) {
      const existingSecret = secretSnap.data() as ServerGameState;
      result = {
        room: roomData,
        gameState: serializePublicState(existingSecret),
        hand: existingSecret.hands?.[uid] ?? [],
      };
      return;
    }

    const now = FieldValue.serverTimestamp();

    // Handle returning to lobby (host-only)
    if (actionType === 'return_lobby') {
      if (roomRaw.hostId !== uid) {
        throw new ApiHttpError(403, 'Only the host can return the room to the lobby.');
      }
      tx.update(roomRef, {
        status: 'waiting',
        updatedAt: now,
      });
      tx.delete(secretRef);
      tx.delete(stateRef);
      for (const p of players) {
        tx.delete(roomRef.collection('hands').doc(p.id));
        tx.update(roomRef.collection('players').doc(p.id), {
          cardCount: 0,
          isReady: p.id === roomRaw.hostId,
          lastSeen: now,
        });
      }
      result = {
        room: {
          ...roomData,
          status: 'waiting',
          players: players.map((p) => ({
            ...p,
            isReady: p.id === roomRaw.hostId,
          })),
        },
        gameState: null,
        hand: [],
      };
      return;
    }

    // Handle leaving (either in lobby or during an active match)
    if (actionType === 'leave') {
      const remaining = players.filter((p) => p.id !== uid);
      tx.delete(roomRef.collection('players').doc(uid));
      tx.delete(roomRef.collection('hands').doc(uid));

      if (remaining.length === 0) {
        tx.update(roomRef, {
          status: 'closed',
          playerCount: 0,
          updatedAt: now,
        });
        tx.delete(secretRef);
        tx.delete(stateRef);
        result = {
          room: { ...roomData, status: 'closed', players: [] },
          gameState: null,
          hand: [],
        };
        return;
      }

      let nextHostId = roomData.hostId;
      if (nextHostId === uid) {
        nextHostId = remaining[0].id;
        tx.update(roomRef.collection('players').doc(nextHostId), {
          isHost: true,
          lastSeen: now,
        });
      }

      if (!secretSnap.exists) {
        tx.update(roomRef, {
          hostId: nextHostId,
          playerCount: remaining.length,
          updatedAt: now,
        });
        result = {
          room: {
            ...roomData,
            hostId: nextHostId,
            players: remaining.map((p) => ({ ...p, isHost: p.id === nextHostId })),
          },
          gameState: null,
          hand: [],
        };
        return;
      }

      const game = serializeSecretState(secretSnap.data() as ServerGameState);
      const removedCards = game.hands[uid] ?? [];
      delete game.hands[uid];
      delete game.scores[uid];
      delete game.calledUno[uid];
      delete game.unoVulnerable[uid];
      game.drawPile = shuffleCards([...game.drawPile, ...removedCards]);
      game.players = remaining.map((p) => ({ ...p, isHost: p.id === nextHostId }));

      const activeRemaining = game.players.filter((p) => !p.isSpectator);
      const leavingName = players.find((p) => p.id === uid)?.username ?? 'Player';

      if (game.gameStatus === 'playing' && activeRemaining.length < 2) {
        game.gameStatus = 'finished';
        game.winnerId = activeRemaining[0]?.id ?? null;
        game.turnExpiresAt = null;
        game.lastAction = `${leavingName} left. ${activeRemaining[0]?.username ?? 'Host'} wins by forfeit!`;
        game.actionSeq += 1;
        game.roundStandings = activeRemaining.map((p, idx) => ({
          playerId: p.id,
          username: p.username,
          avatar: p.avatar,
          remainingCards: (game.hands[p.id] ?? []).length,
          roundPointsGained: 0,
          totalScore: game.scores[p.id] ?? 0,
          rank: idx + 1,
        }));
      } else if (game.gameStatus === 'playing' && game.currentPlayerId === uid && activeRemaining.length > 0) {
        game.currentPlayerId = activeRemaining[0].id;
        game.pendingColorChoiceBy = null;
        game.pendingSwapBy = null;
        game.pendingChallenge = null;
        game.hasDrawnThisTurnBy = null;
        game.drawnCardPlayableId = null;
        game.turnExpiresAt = game.rules.turnTimerSeconds
          ? Date.now() + game.rules.turnTimerSeconds * 1000
          : null;
        game.actionSeq += 1;
        game.lastAction = `${leavingName} left the match.`;
      } else {
        game.actionSeq += 1;
        game.lastAction = `${leavingName} left the match.`;
      }

      const publicState = serializePublicState(game);
      tx.update(roomRef, {
        hostId: nextHostId,
        playerCount: remaining.length,
        ...(game.gameStatus === 'finished' ? { status: 'finished' } : {}),
        updatedAt: now,
      });
      tx.set(secretRef, { ...game, updatedAt: now });
      tx.set(stateRef, { ...publicState, updatedAt: now });

      result = {
        room: { ...roomData, hostId: nextHostId, players: game.players },
        gameState: publicState,
        hand: [],
      };
      return;
    }

    // Handle fresh match restart from Results (host-only)
    if (actionType === 'restart') {
      if (roomRaw.hostId !== uid) {
        throw new ApiHttpError(403, 'Only the host can restart the match.');
      }
      const activePlayers = players.filter((p) => !p.isSpectator);
      if (activePlayers.length < 2) {
        throw new ApiHttpError(400, 'At least 2 players are required to restart.');
      }
      const fresh = createInitialGameState(
        roomId,
        roomData.gameMode,
        roomData.customRules,
        players
      );
      const publicState = serializePublicState(fresh);
      const secretState = serializeSecretState(fresh);

      tx.update(roomRef, { status: 'playing', updatedAt: now });
      tx.set(secretRef, { ...secretState, updatedAt: now });
      tx.set(stateRef, { ...publicState, updatedAt: now });
      for (const p of players) {
        const pHand = fresh.hands[p.id] ?? [];
        tx.set(roomRef.collection('hands').doc(p.id), {
          playerId: p.id,
          cards: pHand,
          updatedAt: now,
        });
        tx.update(roomRef.collection('players').doc(p.id), {
          cardCount: pHand.length,
          lastSeen: now,
        });
      }
      result = {
        room: { ...roomData, status: 'playing' },
        gameState: publicState,
        hand: fresh.hands[uid] ?? [],
      };
      return;
    }

    // All remaining actions require an initialized secret game state
    if (!secretSnap.exists) {
      throw new ApiHttpError(404, 'No active game session found in this room.');
    }

    const currentSecret = serializeSecretState(secretSnap.data() as ServerGameState);
    const prevStatus = currentSecret.gameStatus;
    let nextSecret: ServerGameState;

    try {
      switch (actionType) {
        case 'play_cards': {
          const cardIds = Array.isArray(payload.cardIds)
            ? payload.cardIds.map(String)
            : typeof payload.cardId === 'string' && payload.cardId
            ? [payload.cardId]
            : [];
          if (cardIds.length === 0) {
            throw new ApiHttpError(400, 'Select at least one card to play.');
          }
          const chosenColor = payload.chosenColor
            ? (String(payload.chosenColor) as CardColor)
            : undefined;
          nextSecret = playCardsAction(currentSecret, uid, cardIds, chosenColor, rawActionId);
          break;
        }
        case 'draw_card':
          nextSecret = drawCardAction(currentSecret, uid, rawActionId);
          break;
        case 'choose_color':
          nextSecret = chooseColorAction(
            currentSecret,
            uid,
            String(payload.color) as CardColor,
            rawActionId
          );
          break;
        case 'swap_hands':
          nextSecret = swapHandsAction(
            currentSecret,
            uid,
            String(payload.targetPlayerId || ''),
            rawActionId
          );
          break;
        case 'challenge_wild4':
          nextSecret = challengeWild4Action(
            currentSecret,
            uid,
            Boolean(payload.challenge),
            rawActionId
          );
          break;
        case 'call_uno':
          nextSecret = callUnoAction(currentSecret, uid, rawActionId);
          break;
        case 'catch_uno':
          nextSecret = catchUnoAction(
            currentSecret,
            uid,
            String(payload.targetPlayerId || ''),
            rawActionId
          );
          break;
        case 'pass_turn':
          nextSecret = passTurnAction(currentSecret, uid, rawActionId);
          break;
        case 'timeout': {
          if (
            (typeof payload.expectedSeq === 'number' &&
              payload.expectedSeq !== currentSecret.actionSeq) ||
            !currentSecret.turnExpiresAt ||
            Date.now() < currentSecret.turnExpiresAt - 1500
          ) {
            // Turn already advanced or timer has not expired yet; return current state safely
            result = {
              room: roomData,
              gameState: serializePublicState(currentSecret),
              hand: currentSecret.hands[uid] ?? [],
            };
            return;
          }
          nextSecret = handleTurnTimeout(currentSecret);
          break;
        }
        case 'next_round':
          if (roomRaw.hostId !== uid) {
            throw new ApiHttpError(403, 'Only the host can start the next round.');
          }
          nextSecret = startNextRoundAction(currentSecret);
          break;
        default:
          throw new ApiHttpError(400, `Unsupported game action: ${String(actionType)}`);
      }
    } catch (err) {
      if (err instanceof GameEngineError) {
        throw new ApiHttpError(400, err.message);
      }
      throw err;
    }

    const nextPublic = serializePublicState(nextSecret);
    const nextSecretClean = serializeSecretState(nextSecret);
    const nextRoomStatus: RoomData['status'] =
      nextSecret.gameStatus === 'finished' ? 'finished' : 'playing';

    if (roomRaw.status !== nextRoomStatus) {
      tx.update(roomRef, {
        status: nextRoomStatus,
        updatedAt: now,
      });
    }

    tx.set(secretRef, {
      ...nextSecretClean,
      updatedAt: now,
    });
    tx.set(stateRef, {
      ...nextPublic,
      updatedAt: now,
    });

    for (const p of nextSecret.players) {
      const pHand = nextSecret.hands[p.id] ?? [];
      tx.set(roomRef.collection('hands').doc(p.id), {
        playerId: p.id,
        cards: pHand,
        updatedAt: now,
      });
      tx.update(roomRef.collection('players').doc(p.id), {
        cardCount: pHand.length,
        ...(p.id === uid ? { lastSeen: now } : {}),
      });
    }

    tx.set(actionRef, {
      actionId: rawActionId,
      playerId: uid,
      actionType,
      details: JSON.stringify(payload).slice(0, 240),
      timestamp: now,
    });

    if (prevStatus !== 'finished' && nextSecret.gameStatus === 'finished') {
      matchJustFinishedWinner = nextSecret.winnerId;
      playersForStats = nextSecret.players;
    }

    result = {
      room: { ...roomData, status: nextRoomStatus },
      gameState: nextPublic,
      hand: nextSecret.hands[uid] ?? [],
    };
  });

  if (playersForStats.length > 0) {
    await recordMatchStats(matchJustFinishedWinner, playersForStats);
  }

  return result;
}
