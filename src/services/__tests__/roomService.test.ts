import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFirestoreStore = new Map<string, Record<string, unknown>>();
let mockCurrentUser: { uid: string; isAnonymous: boolean } | null = {
  uid: 'host_user_123',
  isAnonymous: true,
};
let forceNextTransactionError: Error | null = null;
let autoIdCounter = 0;

vi.mock('firebase/firestore', () => {
  const doc = (_dbOrCol: unknown, ...segments: string[]) => {
    if (segments.length === 0) {
      autoIdCounter += 1;
      return { id: `fs_room_${autoIdCounter}`, path: `rooms/fs_room_${autoIdCounter}` };
    }
    const path = segments.join('/');
    return { id: segments[segments.length - 1], path };
  };
  const collection = (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  });
  const serverTimestamp = () => ({ __type: 'serverTimestamp', ms: Date.now() });
  class Timestamp {
    constructor(private ms: number) {}
    toMillis() {
      return this.ms;
    }
  }
  const getDoc = async (ref: { path: string }) => {
    const data = mockFirestoreStore.get(ref.path);
    return {
      exists: () => Boolean(data),
      id: ref.path.split('/').pop(),
      data: () => data,
    };
  };
  const getDocs = async (q: { path: string }) => {
    const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
    for (const [k, v] of mockFirestoreStore.entries()) {
      if (k.startsWith(q.path + '/')) {
        docs.push({ id: k.split('/').pop()!, data: () => v });
      }
    }
    return { docs };
  };
  const query = (colRef: { path: string }) => colRef;
  const orderBy = () => ({});
  const increment = (n: number) => ({ __inc: n });
  const updateDoc = async (ref: { path: string }, updates: Record<string, unknown>) => {
    const existing = mockFirestoreStore.get(ref.path) || {};
    mockFirestoreStore.set(ref.path, { ...existing, ...updates });
  };
  const deleteDoc = async (ref: { path: string }) => {
    mockFirestoreStore.delete(ref.path);
  };
  const runTransaction = async (
    _db: unknown,
    fn: (tx: {
      get: typeof getDoc;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: typeof updateDoc;
    }) => Promise<void>
  ) => {
    if (forceNextTransactionError) {
      const err = forceNextTransactionError;
      forceNextTransactionError = null;
      throw err;
    }
    const pending = new Map<string, Record<string, unknown>>();
    const tx = {
      get: getDoc,
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        pending.set(ref.path, data);
      },
      update: async (ref: { path: string }, updates: Record<string, unknown>) => {
        const existing = mockFirestoreStore.get(ref.path) || {};
        pending.set(ref.path, { ...existing, ...updates });
      },
    };
    await fn(tx);
    for (const [k, v] of pending.entries()) {
      mockFirestoreStore.set(k, v);
    }
  };

  return {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    Timestamp,
    updateDoc,
  };
});

vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
  db: {},
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
}));

import { createPrivateRoom, fetchRoomState } from '../roomService';
import { DEFAULT_CUSTOM_RULES } from '../../engine/gameTypes';

describe('roomService private room creation & Firestore integration', () => {
  beforeEach(() => {
    mockFirestoreStore.clear();
    mockCurrentUser = { uid: 'host_user_123', isAnonymous: true };
    forceNextTransactionError = null;
    autoIdCounter = 0;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          room: null,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    ) as unknown as typeof fetch;
  });

  it('creates a Classic UNO room in Firestore and returns expected payload', async () => {
    const res = await createPrivateRoom('tok_123', {
      roomName: 'Classic Table',
      gameMode: 'classic',
      maxPlayers: 10,
      customRules: DEFAULT_CUSTOM_RULES,
      username: 'Alex',
      avatar: 'crimson',
    });

    expect(res.success).toBe(true);
    expect(res.roomId).toBe('fs_room_1');
    expect(res.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(res.roomName).toBe('Classic Table');
    expect(res.hostId).toBe('host_user_123');
    expect(res.gameMode).toBe('classic');
    expect(res.maxPlayers).toBe(10);
    expect(res.status).toBe('waiting');
    expect(res.room.players[0].username).toBe('Alex');

    const savedRoom = mockFirestoreStore.get(`rooms/${res.roomId}`);
    expect(savedRoom).toBeTruthy();
    expect(savedRoom?.privacy).toBe('private');
    expect(savedRoom?.status).toBe('waiting');
    expect(savedRoom?.roomCode).toBe(res.roomCode);

    const savedPlayer = mockFirestoreStore.get(`rooms/${res.roomId}/players/host_user_123`);
    expect(savedPlayer).toBeTruthy();
    expect(savedPlayer?.isHost).toBe(true);
    expect(savedPlayer?.username).toBe('Alex');
  });

  it('creates an UNO Flip room with 2 players maximum', async () => {
    const res = await createPrivateRoom('tok_123', {
      roomName: 'Flip Duel',
      gameMode: 'flip',
      maxPlayers: 2,
      customRules: DEFAULT_CUSTOM_RULES,
      username: 'Maya',
      avatar: 'cobalt',
    });

    expect(res.success).toBe(true);
    expect(res.gameMode).toBe('flip');
    expect(res.maxPlayers).toBe(2);
    expect(mockFirestoreStore.get(`rooms/${res.roomId}`)?.maxPlayers).toBe(2);
  });

  it('creates a Custom UNO room with 10 players maximum', async () => {
    const res = await createPrivateRoom('tok_123', {
      roomName: 'Friday Night UNO',
      gameMode: 'custom',
      maxPlayers: 10,
      customRules: { ...DEFAULT_CUSTOM_RULES, stackDrawTwo: true, sevenORule: true },
      username: 'Host',
      avatar: 'emerald',
    });

    expect(res.success).toBe(true);
    expect(res.gameMode).toBe('custom');
    expect(res.maxPlayers).toBe(10);
    expect(res.status).toBe('waiting');
  });

  it('loads room data from Firestore on lobby refresh when server returns 404', async () => {
    const created = await createPrivateRoom('tok_123', {
      roomName: 'Refresh Test Room',
      gameMode: 'custom',
      maxPlayers: 6,
      customRules: DEFAULT_CUSTOM_RULES,
      username: 'Jordan',
      avatar: 'amber',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Room not found.' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const restored = await fetchRoomState('tok_123', created.roomId);
    expect(restored.room.roomId).toBe(created.roomId);
    expect(restored.room.roomCode).toBe(created.roomCode);
    expect(restored.room.roomName).toBe('Refresh Test Room');
    expect(restored.room.maxPlayers).toBe(6);
    expect(restored.room.players).toHaveLength(1);
    expect(restored.room.players[0].username).toBe('Jordan');
  });

  it('throws clear error instead of returning undefined when server returns non-JSON HTML in fallback mode', async () => {
    mockCurrentUser = null;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    ) as unknown as typeof fetch;

    await expect(
      createPrivateRoom('tok_123', {
        roomName: 'HTML Fallback Bug',
        gameMode: 'classic',
        maxPlayers: 10,
        customRules: DEFAULT_CUSTOM_RULES,
        username: 'Host',
        avatar: 'crimson',
      })
    ).rejects.toThrow(/non-JSON response/i);
  });

  it('maps Firestore permission-denied errors cleanly', async () => {
    const permErr = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    forceNextTransactionError = permErr;

    await expect(
      createPrivateRoom('tok_123', {
        roomName: 'Perm Test',
        gameMode: 'classic',
        maxPlayers: 4,
        customRules: DEFAULT_CUSTOM_RULES,
        username: 'Host',
        avatar: 'crimson',
      })
    ).rejects.toThrow(/permission denied/i);
  });
});
