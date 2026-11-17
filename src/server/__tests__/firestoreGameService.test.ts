import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { DEFAULT_CUSTOM_RULES, PublicGameState, ServerGameState, UnoCard } from '../../engine/gameTypes';

interface MockDocRecord {
  data: Record<string, unknown>;
}

const mockStore = new Map<string, MockDocRecord>();

function createDocRef(path: string) {
  const parts = path.split('/');
  const id = parts[parts.length - 1];
  return {
    id,
    path,
    collection: (sub: string) => createCollectionRef(`${path}/${sub}`),
    update: async (updates: Record<string, unknown>) => {
      const rec = mockStore.get(path);
      const cur = rec ? rec.data : {};
      mockStore.set(path, { data: applyUpdates(cur, clone(updates)) });
    },
  };
}

function createCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => createDocRef(`${path}/${id}`),
    orderBy: () => ({
      __collectionPath: path,
    }),
  };
}

function applyUpdates(
  current: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(updates)) {
    if (v && typeof v === 'object' && '__inc' in v) {
      next[k] = Number(next[k] || 0) + Number((v as { __inc: number }).__inc);
    } else if (v && typeof v === 'object' && '__serverTimestamp' in v) {
      next[k] = Date.now();
    } else {
      next[k] = v;
    }
  }
  return next;
}

function clone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

function resolveSentinels(obj: Record<string, unknown>): Record<string, unknown> {
  return applyUpdates({}, obj);
}

vi.mock('firebase-admin/firestore', () => {
  class Timestamp {
    constructor(private ms: number) {}
    toMillis() {
      return this.ms;
    }
  }
  return {
    Timestamp,
    FieldValue: {
      increment: (n: number) => ({ __inc: n }),
      serverTimestamp: () => ({ __serverTimestamp: true }),
    },
  };
});

let mockVerifiedUid = 'player_1';
let mockAuthShouldFail = false;

vi.mock('../firebaseAdmin', async () => {
  class ApiHttpError extends Error {
    constructor(
      public readonly statusCode: number,
      message: string
    ) {
      super(message);
      this.name = 'ApiHttpError';
    }
  }

  const adminDb = {
    collection: (name: string) => createCollectionRef(name),
    runTransaction: async (
      fn: (tx: {
        get: (target: unknown) => Promise<unknown>;
        set: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
        delete: (ref: { path: string }) => void;
      }) => Promise<void>
    ) => {
      const writes = new Map<string, Record<string, unknown> | null>();

      const getSingle = (path: string) => {
        if (writes.has(path)) {
          const val = writes.get(path);
          return {
            exists: val !== null,
            id: path.split('/').pop()!,
            ref: createDocRef(path),
            data: () => (val ? clone(val) : undefined),
          };
        }
        const rec = mockStore.get(path);
        return {
          exists: Boolean(rec),
          id: path.split('/').pop()!,
          ref: createDocRef(path),
          data: () => (rec ? clone(rec.data) : undefined),
        };
      };

      const tx = {
        get: async (target: unknown) => {
          if (
            target &&
            typeof target === 'object' &&
            '__collectionPath' in target
          ) {
            const prefix = `${(target as { __collectionPath: string }).__collectionPath}/`;
            const docs: Array<{
              id: string;
              ref: ReturnType<typeof createDocRef>;
              data: () => Record<string, unknown>;
            }> = [];
            for (const [key, rec] of mockStore.entries()) {
              if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
                docs.push({
                  id: key.slice(prefix.length),
                  ref: createDocRef(key),
                  data: () => clone(rec.data),
                });
              }
            }
            docs.sort(
              (a, b) => Number(a.data().joinedAt || 0) - Number(b.data().joinedAt || 0)
            );
            return { docs, size: docs.length };
          }
          return getSingle((target as { path: string }).path);
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          writes.set(ref.path, resolveSentinels(clone(data)));
        },
        update: (ref: { path: string }, updates: Record<string, unknown>) => {
          const cur = getSingle(ref.path).data() || {};
          writes.set(ref.path, applyUpdates(cur, clone(updates)));
        },
        delete: (ref: { path: string }) => {
          writes.set(ref.path, null);
        },
      };

      await fn(tx);

      for (const [k, v] of writes.entries()) {
        if (v === null) {
          mockStore.delete(k);
        } else {
          mockStore.set(k, { data: v });
        }
      }
    },
  };

  return {
    ApiHttpError,
    getFirebaseAdmin: () => ({ adminDb }),
    hasAdminCredentialsConfigured: () => true,
    verifyFirebaseBearerToken: async (header: string | string[] | undefined) => {
      if (mockAuthShouldFail || !header || !String(header).startsWith('Bearer ')) {
        throw new ApiHttpError(401, 'Unauthorized Firebase ID token.');
      }
      return { uid: mockVerifiedUid, email: null };
    },
  };
});

import { executeMatchActionInFirestore, startMatchInFirestore } from '../firestoreGameService';
import startEndpoint from '../../../api/game/start';
import playCardEndpoint from '../../../api/game/play-card';
import actionEndpoint from '../../../api/game/action';

function seedRoom(
  roomId: string,
  options: {
    gameMode?: 'classic' | 'flip' | 'custom';
    playerCount?: number;
    maxPlayers?: number;
    customRules?: Partial<typeof DEFAULT_CUSTOM_RULES>;
  } = {}
) {
  const mode = options.gameMode || 'classic';
  const count = options.playerCount ?? 2;
  const maxPlayers = options.maxPlayers ?? 10;

  mockStore.set(`rooms/${roomId}`, {
    data: {
      roomId,
      roomCode: 'ABC123',
      roomName: 'Arena Match',
      hostId: 'player_1',
      privacy: 'private',
      gameMode: mode,
      maxPlayers,
      playerCount: count,
      status: 'waiting',
      customRules: { ...DEFAULT_CUSTOM_RULES, ...(options.customRules || {}) },
      createdAt: 1000,
      updatedAt: 1000,
    },
  });

  for (let i = 1; i <= count; i++) {
    const pid = `player_${i}`;
    mockStore.set(`rooms/${roomId}/players/${pid}`, {
      data: {
        playerId: pid,
        roomId,
        username: `Player${i}`,
        avatar: 'crimson',
        isHost: i === 1,
        isReady: true,
        cardCount: 0,
        connectionStatus: 'online',
        joinedAt: 1000 + i * 10,
        lastSeen: 1000 + i * 10,
      },
    });
    mockStore.set(`users/${pid}`, {
      data: {
        uid: pid,
        username: `Player${i}`,
        avatar: 'crimson',
        isAnonymous: true,
        gamesPlayed: 0,
        wins: 0,
        createdAt: 1000,
        updatedAt: 1000,
      },
    });
  }
}

function makeCard(
  id: string,
  color: 'red' | 'blue' | 'green' | 'yellow' | 'wild',
  value: UnoCard['light']['value'],
  darkColor: 'pink' | 'teal' | 'orange' | 'purple' | 'wild' = 'pink',
  darkValue: NonNullable<UnoCard['dark']>['value'] = '1'
): UnoCard {
  return {
    id,
    light: { color, value },
    dark: { color: darkColor, value: darkValue },
  };
}

describe('firestoreGameService authoritative multiplayer engine', () => {
  beforeEach(() => {
    mockStore.clear();
    mockVerifiedUid = 'player_1';
    mockAuthShouldFail = false;
  });

  it('validates host permissions, minimum players, and deals Classic UNO match state atomically', async () => {
    seedRoom('room_1', { playerCount: 1 });
    await expect(startMatchInFirestore('player_1', 'room_1')).rejects.toThrow(
      /At least 2 players/i
    );

    seedRoom('room_1', { playerCount: 2 });
    await expect(startMatchInFirestore('player_2', 'room_1')).rejects.toThrow(
      /Only the room host/i
    );

    const started = await startMatchInFirestore('player_1', 'room_1');
    expect(started.room.status).toBe('playing');
    expect(started.gameState?.gameStatus).toBe('playing');
    expect(started.gameState?.players).toHaveLength(2);
    expect(started.hand).toHaveLength(7);

    // Public game state must never expose secret drawPile
    const publicDoc = mockStore.get('rooms/room_1/game/state')?.data as unknown as PublicGameState & {
      drawPile?: unknown;
    };
    expect(publicDoc.drawPile).toBeUndefined();

    // Secret state and private hands are stored in separate collections
    const secretDoc = mockStore.get('rooms/room_1/secret/state')?.data as unknown as ServerGameState;
    expect(secretDoc.drawPile.length).toBeGreaterThan(50);
    expect(mockStore.get('rooms/room_1/hands/player_1')?.data.cards).toHaveLength(7);
    expect(mockStore.get('rooms/room_1/hands/player_2')?.data.cards).toHaveLength(7);
    expect(mockStore.get('rooms/room_1/players/player_1')?.data.cardCount).toBe(7);

    // Prevent starting the same match twice
    await expect(startMatchInFirestore('player_1', 'room_1')).rejects.toThrow(/already started/i);
  });

  it('supports Classic UNO play, draw, UNO call/catch, win detection, and stats recording', async () => {
    seedRoom('room_classic', { playerCount: 2 });
    await startMatchInFirestore('player_1', 'room_classic');

    // Control deterministic hands & top card in secret state for turn validation test
    const secretRec = mockStore.get('rooms/room_classic/secret/state')!;
    const secret = secretRec.data as unknown as ServerGameState;
    secret.currentPlayerId = 'player_1';
    secret.currentColor = 'red';
    secret.currentDirection = 1;
    secret.discardPile = [makeCard('top_r5', 'red', '5')];
    secret.hands = {
      player_1: [makeCard('p1_r7', 'red', '7'), makeCard('p1_b2', 'blue', '2')],
      player_2: [makeCard('p2_r9', 'red', '9'), makeCard('p2_g3', 'green', '3')],
    };
    mockStore.set('rooms/room_classic/secret/state', { data: secret as unknown as Record<string, unknown> });

    // Reject Player 2 playing out of turn
    await expect(
      executeMatchActionInFirestore('player_2', 'room_classic', 'play_cards', {
        cardIds: ['p2_r9'],
      })
    ).rejects.toThrow(/Not your turn/i);

    // Player 1 plays red 7 -> drops to 1 card and becomes UNO vulnerable!
    const afterP1 = await executeMatchActionInFirestore('player_1', 'room_classic', 'play_cards', {
      cardIds: ['p1_r7'],
      actionId: 'act_p1_1',
    });
    expect(afterP1.hand).toHaveLength(1);
    expect(afterP1.gameState?.currentPlayerId).toBe('player_2');
    expect(afterP1.gameState?.players.find((p) => p.id === 'player_1')?.unoVulnerable).toBe(true);

    // Idempotent replay returns same state without re-applying
    const replayP1 = await executeMatchActionInFirestore('player_1', 'room_classic', 'play_cards', {
      cardIds: ['p1_r7'],
      actionId: 'act_p1_1',
    });
    expect(replayP1.gameState?.actionSeq).toBe(afterP1.gameState?.actionSeq);

    // Player 2 catches Player 1 for forgetting UNO (+2 penalty cards)
    const afterCatch = await executeMatchActionInFirestore('player_2', 'room_classic', 'catch_uno', {
      targetPlayerId: 'player_1',
    });
    expect(afterCatch.gameState?.players.find((p) => p.id === 'player_1')?.cardCount).toBe(3);

    // Player 2 plays red 9 -> drops to 1 card and calls UNO!
    await executeMatchActionInFirestore('player_2', 'room_classic', 'play_cards', {
      cardIds: ['p2_r9'],
    });
    await executeMatchActionInFirestore('player_2', 'room_classic', 'call_uno');

    // Player 1 draws a card -> turn goes to Player 2
    await executeMatchActionInFirestore('player_1', 'room_classic', 'draw_card');
    // Force pass if playable was drawn
    const postDrawState = mockStore.get('rooms/room_classic/game/state')?.data as unknown as PublicGameState;
    if (postDrawState.currentPlayerId === 'player_1') {
      await executeMatchActionInFirestore('player_1', 'room_classic', 'pass_turn');
    }

    // Set Player 2's remaining card to red 3 to win on red 9
    const preWin = mockStore.get('rooms/room_classic/secret/state')!.data as unknown as ServerGameState;
    preWin.hands.player_2 = [makeCard('p2_win_r3', 'red', '3')];
    mockStore.set('rooms/room_classic/secret/state', { data: preWin as unknown as Record<string, unknown> });

    const winRes = await executeMatchActionInFirestore('player_2', 'room_classic', 'play_cards', {
      cardIds: ['p2_win_r3'],
    });
    expect(winRes.gameState?.gameStatus).toBe('finished');
    expect(winRes.gameState?.winnerId).toBe('player_2');
    expect(winRes.room.status).toBe('finished');

    // Verify stats recorded on /users/{uid}
    expect(mockStore.get('users/player_2')?.data.wins).toBe(1);
    expect(mockStore.get('users/player_2')?.data.gamesPlayed).toBe(1);
    expect(mockStore.get('users/player_1')?.data.gamesPlayed).toBe(1);
    expect(mockStore.get('users/player_1')?.data.wins).toBe(0);
  });

  it('supports UNO Flip dark-side switching, Draw 5, and Skip Everyone', async () => {
    seedRoom('room_flip', { gameMode: 'flip', playerCount: 3 });
    await startMatchInFirestore('player_1', 'room_flip');

    const secret = mockStore.get('rooms/room_flip/secret/state')!.data as unknown as ServerGameState;
    secret.currentPlayerId = 'player_1';
    secret.currentSide = 'light';
    secret.currentColor = 'red';
    secret.discardPile = [makeCard('flip_top', 'red', '4', 'pink', '4')];
    secret.hands = {
      player_1: [
        makeCard('flip_card', 'red', 'flip', 'teal', 'skip_everyone'),
        makeCard('p1_teal5', 'blue', '2', 'teal', 'draw5'),
      ],
      player_2: [makeCard('p2_d1', 'green', '1', 'teal', '1')],
      player_3: [makeCard('p3_d1', 'yellow', '2', 'purple', '2')],
    };
    mockStore.set('rooms/room_flip/secret/state', { data: secret as unknown as Record<string, unknown> });

    const flipped = await executeMatchActionInFirestore('player_1', 'room_flip', 'play_cards', {
      cardIds: ['flip_card'],
    });
    expect(flipped.gameState?.currentSide).toBe('dark');
    expect(flipped.gameState?.currentColor).toBe('teal');
    expect(flipped.gameState?.currentPlayerId).toBe('player_2');
  });

  it('supports Custom UNO stacking, timeout enforcement, and 10-player wrap-around', async () => {
    seedRoom('room_custom_10', {
      gameMode: 'custom',
      playerCount: 10,
      maxPlayers: 10,
      customRules: {
        stackDrawTwo: true,
        turnTimerSeconds: 15,
      },
    });

    const started = await startMatchInFirestore('player_1', 'room_custom_10');
    expect(started.gameState?.players).toHaveLength(10);
    expect(mockStore.get('rooms/room_custom_10/hands/player_10')?.data.cards).toHaveLength(7);

    // Simulate player_10's turn & turn timer expired
    const secret = mockStore.get('rooms/room_custom_10/secret/state')!.data as unknown as ServerGameState;
    secret.currentPlayerId = 'player_10';
    secret.turnExpiresAt = Date.now() - 3000;
    const expiredSeq = secret.actionSeq;
    mockStore.set('rooms/room_custom_10/secret/state', { data: secret as unknown as Record<string, unknown> });

    const afterTimeout = await executeMatchActionInFirestore('player_1', 'room_custom_10', 'timeout', {
      expectedSeq: expiredSeq,
    });
    // Player 10 timed out -> turn wraps cleanly around 10 players to Player 1
    expect(afterTimeout.gameState?.currentPlayerId).toBe('player_1');
    expect(afterTimeout.gameState?.actionSeq).toBeGreaterThan(expiredSeq);

    // Duplicate timeout with stale expectedSeq does not double-advance
    const dupTimeout = await executeMatchActionInFirestore('player_2', 'room_custom_10', 'timeout', {
      expectedSeq: expiredSeq,
    });
    expect(dupTimeout.gameState?.currentPlayerId).toBe('player_1');
    expect(dupTimeout.gameState?.actionSeq).toBe(afterTimeout.gameState?.actionSeq);
  });

  it('handles active-match leave with forfeit win and return-to-lobby cleanup', async () => {
    seedRoom('room_leave', { playerCount: 2 });
    await startMatchInFirestore('player_1', 'room_leave');

    const leaveRes = await executeMatchActionInFirestore('player_2', 'room_leave', 'leave');
    expect(leaveRes.gameState?.gameStatus).toBe('finished');
    expect(leaveRes.gameState?.winnerId).toBe('player_1');
    expect(mockStore.get('rooms/room_leave/players/player_2')).toBeUndefined();
    expect(mockStore.get('rooms/room_leave/hands/player_2')).toBeUndefined();

    const lobbyRes = await executeMatchActionInFirestore('player_1', 'room_leave', 'return_lobby');
    expect(lobbyRes.room.status).toBe('waiting');
    expect(lobbyRes.gameState).toBeNull();
    expect(mockStore.get('rooms/room_leave/game/state')).toBeUndefined();
    expect(mockStore.get('rooms/room_leave/secret/state')).toBeUndefined();
  });

  it('validates Vercel Serverless API endpoint authentication, status codes, and payload routing', async () => {
    seedRoom('room_api', { playerCount: 2 });

    const invokeEndpoint = async (
      handler: (req: never, res: never) => Promise<void>,
      options: { method?: string; authHeader?: string; body?: Record<string, unknown> }
    ) => {
      const reqStream = Readable.from([JSON.stringify(options.body || {})]) as IncomingMessage & {
        method?: string;
        body?: unknown;
      };
      reqStream.method = options.method || 'POST';
      reqStream.headers = options.authHeader ? { authorization: options.authHeader } : {};
      reqStream.body = options.body;

      let statusCode = 200;
      let jsonBody: unknown = null;
      const res = {
        setHeader: () => {},
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          jsonBody = payload;
        },
        end: () => {},
      };

      await handler(reqStream as never, res as never);
      return { statusCode, body: jsonBody as Record<string, unknown> };
    };

    // Missing Bearer token -> 401
    const unauth = await invokeEndpoint(startEndpoint, { body: { roomId: 'room_api' } });
    expect(unauth.statusCode).toBe(401);

    // Wrong HTTP method -> 405
    const wrongMethod = await invokeEndpoint(playCardEndpoint, {
      method: 'GET',
      authHeader: 'Bearer valid_tok',
      body: { roomId: 'room_api' },
    });
    expect(wrongMethod.statusCode).toBe(405);

    // Host starts game via /api/game/start -> 200
    mockVerifiedUid = 'player_1';
    const startOk = await invokeEndpoint(startEndpoint, {
      authHeader: 'Bearer valid_tok',
      body: { roomId: 'room_api' },
    });
    expect(startOk.statusCode).toBe(200);
    expect(startOk.body.success).toBe(true);
    expect((startOk.body.hand as UnoCard[]).length).toBe(7);

    // Invalid actionType -> 400
    const badAction = await invokeEndpoint(actionEndpoint, {
      authHeader: 'Bearer valid_tok',
      body: { roomId: 'room_api', actionType: 'cheat_win' },
    });
    expect(badAction.statusCode).toBe(400);
  });
});
