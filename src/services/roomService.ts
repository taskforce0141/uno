import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  CustomRulesConfig,
  GameMode,
  PlayerRecord,
  PublicGameState,
  RoomData,
  UnoCard,
} from '../engine/gameTypes';
import { resolveRulesForMode } from '../engine/customRules';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { firebaseGameApiRequest } from './gameService';
import { buildApiUrl } from './sessionService';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface CreateRoomResult {
  success: true;
  roomId: string;
  roomCode: string;
  roomName: string;
  hostId: string;
  gameMode: GameMode;
  maxPlayers: number;
  status: 'waiting' | 'lobby';
  room: RoomData;
}

export interface RoomLookupInfo {
  roomId: string;
  roomCode: string;
  roomName: string;
  gameMode: GameMode;
  playerCount: number;
  maxPlayers: number;
  status: RoomData['status'];
  allowLateJoining: boolean;
  allowSpectators: boolean;
}

export interface RoomStateResponse {
  room: RoomData;
  gameState: PublicGameState | null;
  hand: UnoCard[];
}

function generateCandidateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function normalizeUsername(name: string, fallback = 'Host'): string {
  let clean = (name || '').trim().slice(0, 24);
  if (clean.length < 2) {
    clean = clean.length === 1 ? `${clean}_` : fallback;
  }
  return clean;
}

function toMillis(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function mapFirebaseRoomError(err: unknown, path: string): Error {
  const code = (err as { code?: string })?.code || '';
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
    console.error(
      'Firestore Error: ',
      JSON.stringify({
        error: message,
        operationType: OperationType.WRITE,
        path,
        authInfo: {
          userId: auth.currentUser?.uid ?? null,
          isAnonymous: auth.currentUser?.isAnonymous ?? null,
        },
      })
    );
    return new Error(
      'Database permission denied while accessing this private room. Please verify you are signed in and try again.'
    );
  }

  if (code === 'unauthenticated') {
    return new Error('Authentication session required. Please sign in and try again.');
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('offline')
  ) {
    return new Error('Network error reaching Firebase. Please check your connection and try again.');
  }

  if (code === 'already-exists') {
    return new Error('A room with that code already exists. Please try creating again.');
  }

  return err instanceof Error ? err : new Error(message || 'Unexpected room service error.');
}

async function apiRequest<T>(
  url: string,
  sessionToken: string,
  options: RequestInit = {}
): Promise<T> {
  const targetUrl = buildApiUrl(url);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('Network error contacting the multiplayer server.');
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  let data: Record<string, unknown> | null = null;

  if (text && contentType.includes('application/json')) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON response from server (${res.status}).`);
    }
  } else if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Unexpected non-JSON response from ${url} (HTTP ${res.status}). Multiplayer API may be unavailable.`
      );
    }
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data.error === 'string' && data.error
        ? data.error
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Empty response received from multiplayer server.');
  }

  return data as T;
}

async function readRoomFromFirestore(roomId: string): Promise<RoomData> {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    throw new Error('Private room not found.');
  }
  const d = roomSnap.data();
  if (d.status === 'closed') {
    throw new Error('This private room has been closed.');
  }

  const playersSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'players'), orderBy('joinedAt', 'asc'))
  );
  const players: PlayerRecord[] = playersSnap.docs.map((pDoc) => {
    const p = pDoc.data();
    return {
      id: String(p.playerId || pDoc.id),
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
  });

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

export async function createPrivateRoom(
  sessionToken: string,
  params: {
    roomName: string;
    gameMode: GameMode;
    maxPlayers: number;
    customRules: Partial<CustomRulesConfig>;
    username: string;
    avatar: string;
  }
): Promise<CreateRoomResult> {
  const cleanRoomName = (params.roomName || '').trim().slice(0, 40);
  if (cleanRoomName.length < 2) {
    throw new Error('Room name must be at least 2 characters.');
  }

  const gameMode: GameMode = ['classic', 'flip', 'custom'].includes(params.gameMode)
    ? params.gameMode
    : 'classic';
  const clampedMaxPlayers = Math.min(10, Math.max(2, Math.round(Number(params.maxPlayers || 10))));
  const safeUsername = normalizeUsername(params.username, 'Host');
  const safeAvatar = (params.avatar || 'crimson').trim().slice(0, 128) || 'crimson';
  const resolvedRules = resolveRulesForMode(gameMode, params.customRules || {});

  const firebaseUser = auth.currentUser;

  if (firebaseUser) {
    const uid = firebaseUser.uid;
    const roomRef = doc(collection(db, 'rooms'));
    const roomId = roomRef.id;
    let allocatedCode = '';

    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidateCode = generateCandidateRoomCode();
        try {
          await runTransaction(db, async (tx) => {
            const codeRef = doc(db, 'roomCodes', candidateCode);
            const codeSnap = await tx.get(codeRef);
            if (codeSnap.exists()) {
              throw new Error('ROOM_CODE_COLLISION');
            }

            tx.set(roomRef, {
              roomId,
              roomCode: candidateCode,
              roomName: cleanRoomName,
              hostId: uid,
              privacy: 'private',
              gameMode,
              maxPlayers: clampedMaxPlayers,
              playerCount: 1,
              status: 'waiting',
              customRules: resolvedRules,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            tx.set(codeRef, {
              roomCode: candidateCode,
              roomId,
              hostId: uid,
              roomName: cleanRoomName,
              gameMode,
              maxPlayers: clampedMaxPlayers,
              createdAt: serverTimestamp(),
            });

            tx.set(doc(db, 'rooms', roomId, 'players', uid), {
              playerId: uid,
              roomId,
              username: safeUsername,
              avatar: safeAvatar,
              isHost: true,
              isReady: true,
              cardCount: 0,
              connectionStatus: 'online',
              joinedAt: serverTimestamp(),
              lastSeen: serverTimestamp(),
            });
          });

          allocatedCode = candidateCode;
          break;
        } catch (innerErr) {
          if (innerErr instanceof Error && innerErr.message === 'ROOM_CODE_COLLISION') {
            continue;
          }
          throw innerErr;
        }
      }
    } catch (err) {
      throw mapFirebaseRoomError(err, `rooms/${roomId}`);
    }

    if (!allocatedCode) {
      throw new Error('Unable to generate a unique room code. Please try again.');
    }

    const now = Date.now();
    const fallbackRoom: RoomData = {
      roomId,
      roomCode: allocatedCode,
      roomName: cleanRoomName,
      hostId: uid,
      privacy: 'private',
      gameMode,
      maxPlayers: clampedMaxPlayers,
      status: 'waiting',
      customRules: resolvedRules,
      players: [
        {
          id: uid,
          username: safeUsername,
          avatar: safeAvatar,
          isHost: true,
          isReady: true,
          isSpectator: false,
          connectionStatus: 'online',
          joinedAt: now,
          lastSeen: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    // Register with the Express/WebSocket server when available so real-time gameplay syncs immediately
    let syncedRoom = fallbackRoom;
    if (sessionToken) {
      try {
        const apiRes = await apiRequest<{ room?: RoomData }>('/api/rooms', sessionToken, {
          method: 'POST',
          body: JSON.stringify({
            roomId,
            roomCode: allocatedCode,
            hostId: uid,
            roomName: cleanRoomName,
            gameMode,
            maxPlayers: clampedMaxPlayers,
            customRules: resolvedRules,
            username: safeUsername,
            avatar: safeAvatar,
          }),
        });
        if (apiRes && apiRes.room && apiRes.room.roomId && apiRes.room.roomCode) {
          syncedRoom = apiRes.room;
        }
      } catch {
        // Firestore persistence succeeded; real-time server sync can re-hydrate later if temporarily unreachable
      }
    }

    return {
      success: true,
      roomId,
      roomCode: allocatedCode,
      roomName: cleanRoomName,
      hostId: uid,
      gameMode,
      maxPlayers: clampedMaxPlayers,
      status: 'waiting',
      room: syncedRoom,
    };
  }

  // Fallback path when Firebase Anonymous Auth is disabled and server-signed guest session is active
  if (!sessionToken) {
    throw new Error('Authentication required to create a private room.');
  }

  const serverRes = await apiRequest<{
    success?: boolean;
    roomId?: string;
    roomCode?: string;
    roomName?: string;
    hostId?: string;
    gameMode?: GameMode;
    maxPlayers?: number;
    status?: RoomData['status'];
    room?: RoomData;
  }>('/api/rooms', sessionToken, {
    method: 'POST',
    body: JSON.stringify({
      roomName: cleanRoomName,
      gameMode,
      maxPlayers: clampedMaxPlayers,
      customRules: resolvedRules,
      username: safeUsername,
      avatar: safeAvatar,
    }),
  });

  if (!serverRes || !serverRes.room || !serverRes.room.roomId || !serverRes.room.roomCode) {
    throw new Error('Server returned an incomplete room creation response.');
  }

  const createdRoom = serverRes.room;
  return {
    success: true,
    roomId: createdRoom.roomId,
    roomCode: createdRoom.roomCode,
    roomName: createdRoom.roomName,
    hostId: createdRoom.hostId,
    gameMode: createdRoom.gameMode,
    maxPlayers: createdRoom.maxPlayers,
    status: createdRoom.status === 'lobby' ? 'lobby' : 'waiting',
    room: createdRoom,
  };
}

export async function lookupRoomByCode(
  sessionToken: string,
  code: string
): Promise<RoomLookupInfo> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) {
    throw new Error('Room code must be 6 letters or numbers.');
  }

  if (sessionToken) {
    try {
      return await apiRequest<RoomLookupInfo>(
        `/api/rooms/lookup/${encodeURIComponent(clean)}`,
        sessionToken
      );
    } catch (apiErr) {
      if (!auth.currentUser) {
        throw apiErr;
      }
    }
  }

  if (auth.currentUser) {
    const codeSnap = await getDoc(doc(db, 'roomCodes', clean));
    if (codeSnap.exists()) {
      const data = codeSnap.data();
      const previewMode: GameMode = ['classic', 'flip', 'custom'].includes(String(data.gameMode))
        ? (data.gameMode as GameMode)
        : 'classic';
      return {
        roomId: String(data.roomId),
        roomCode: clean,
        roomName:
          typeof data.roomName === 'string' && data.roomName.trim()
            ? data.roomName
            : 'Private UNO Room',
        gameMode: previewMode,
        playerCount: 1,
        maxPlayers:
          typeof data.maxPlayers === 'number'
            ? Math.min(10, Math.max(2, data.maxPlayers))
            : 10,
        status: 'waiting',
        allowLateJoining: false,
        allowSpectators: false,
      };
    }
    throw new Error('Private room not found. Check your 6-character code.');
  }

  throw new Error('Authentication required to look up a private room.');
}

export async function joinRoom(
  sessionToken: string,
  roomIdOrCode: string,
  params: { username: string; avatar: string; asSpectator?: boolean }
): Promise<RoomStateResponse> {
  const safeUsername = normalizeUsername(params.username, 'Player');
  const safeAvatar = (params.avatar || 'cobalt').trim().slice(0, 128) || 'cobalt';

  if (sessionToken) {
    try {
      const res = await apiRequest<RoomStateResponse>(
        `/api/rooms/${encodeURIComponent(roomIdOrCode)}/join`,
        sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({ ...params, username: safeUsername, avatar: safeAvatar }),
        }
      );

      if (!res || !res.room || !res.room.roomId) {
        throw new Error('Invalid room response received when joining.');
      }

      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        try {
          const roomRef = doc(db, 'rooms', res.room.roomId);
          const playerRef = doc(db, 'rooms', res.room.roomId, 'players', firebaseUser.uid);
          await runTransaction(db, async (tx) => {
            const roomSnap = await tx.get(roomRef);
            if (!roomSnap.exists()) return;
            const playerSnap = await tx.get(playerRef);
            if (!playerSnap.exists()) {
              tx.set(playerRef, {
                playerId: firebaseUser.uid,
                roomId: res.room.roomId,
                username: safeUsername,
                avatar: safeAvatar,
                isHost: res.room.hostId === firebaseUser.uid,
                isReady: res.room.hostId === firebaseUser.uid,
                cardCount: 0,
                connectionStatus: 'online',
                joinedAt: serverTimestamp(),
                lastSeen: serverTimestamp(),
              });
              tx.update(roomRef, {
                playerCount: increment(1),
                updatedAt: serverTimestamp(),
              });
            } else {
              tx.update(playerRef, {
                username: safeUsername,
                avatar: safeAvatar,
                connectionStatus: 'online',
                lastSeen: serverTimestamp(),
              });
            }
          });
        } catch {
          // Non-fatal if Firestore sync races
        }
      }

      return res;
    } catch (apiErr) {
      if (!auth.currentUser) {
        throw apiErr;
      }
    }
  }

  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    throw new Error('Authentication required to join a private room.');
  }

  const clean = roomIdOrCode.trim();
  let targetRoomId = clean;
  let codeHostId: string | null = null;
  if (/^[A-Za-z0-9]{6}$/.test(clean)) {
    const codeSnap = await getDoc(doc(db, 'roomCodes', clean.toUpperCase()));
    if (!codeSnap.exists()) {
      throw new Error('Private room not found. Check your 6-character code.');
    }
    const codeData = codeSnap.data();
    targetRoomId = String(codeData.roomId);
    codeHostId = typeof codeData.hostId === 'string' ? codeData.hostId : null;
  }

  try {
    const roomRef = doc(db, 'rooms', targetRoomId);
    const playerRef = doc(db, 'rooms', targetRoomId, 'players', firebaseUser.uid);
    await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists()) {
        const isHost = Boolean(codeHostId && codeHostId === firebaseUser.uid);
        tx.set(playerRef, {
          playerId: firebaseUser.uid,
          roomId: targetRoomId,
          username: safeUsername,
          avatar: safeAvatar,
          isHost,
          isReady: isHost,
          cardCount: 0,
          connectionStatus: 'online',
          joinedAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        });
        tx.update(roomRef, {
          playerCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(playerRef, {
          username: safeUsername,
          avatar: safeAvatar,
          connectionStatus: 'online',
          lastSeen: serverTimestamp(),
        });
      }
    });

    const room = await readRoomFromFirestore(targetRoomId);
    if (sessionToken) {
      await apiRequest('/api/rooms', sessionToken, {
        method: 'POST',
        body: JSON.stringify({
          roomId: room.roomId,
          roomCode: room.roomCode,
          hostId: room.hostId,
          roomName: room.roomName,
          gameMode: room.gameMode,
          maxPlayers: room.maxPlayers,
          customRules: room.customRules,
          players: room.players,
          username: safeUsername,
          avatar: safeAvatar,
        }),
      }).catch(() => {});
    }

    return { room, gameState: null, hand: [] };
  } catch (err) {
    const mapped = mapFirebaseRoomError(err, `rooms/${targetRoomId}/players/${firebaseUser.uid}`);
    if (mapped.message.includes('Database permission denied')) {
      throw new Error(
        'Database permission denied while joining this private room. Verify you are signed in and that the room is still waiting with open seats.'
      );
    }
    throw mapped;
  }
}

export async function fetchRoomState(
  sessionToken: string,
  roomId: string
): Promise<RoomStateResponse> {
  if (sessionToken) {
    try {
      const res = await apiRequest<RoomStateResponse>(
        `/api/rooms/${encodeURIComponent(roomId)}/state`,
        sessionToken
      );
      if (res && res.room && res.room.roomId) {
        return res;
      }
    } catch (apiErr) {
      if (!auth.currentUser) {
        throw apiErr;
      }
    }
  }

  const room = await readRoomFromFirestore(roomId);
  const uid = auth.currentUser?.uid;
  if (uid && !room.players.some((p) => p.id === uid) && room.hostId !== uid) {
    throw new Error('You are not a member of this private room.');
  }

  if (sessionToken) {
    await apiRequest('/api/rooms', sessionToken, {
      method: 'POST',
      body: JSON.stringify({
        roomId: room.roomId,
        roomCode: room.roomCode,
        hostId: room.hostId,
        roomName: room.roomName,
        gameMode: room.gameMode,
        maxPlayers: room.maxPlayers,
        customRules: room.customRules,
        players: room.players,
      }),
    }).catch(() => {});
  }

  let gameState: PublicGameState | null = null;
  let hand: UnoCard[] = [];
  if (room.status === 'playing' || room.status === 'finished') {
    const [stateSnap, handSnap] = await Promise.all([
      getDoc(doc(db, 'rooms', roomId, 'game', 'state')),
      uid ? getDoc(doc(db, 'rooms', roomId, 'hands', uid)) : Promise.resolve(null),
    ]);
    if (stateSnap.exists()) {
      gameState = stateSnap.data() as PublicGameState;
    }
    if (handSnap && handSnap.exists()) {
      hand = ((handSnap.data()?.cards as UnoCard[]) || []).slice();
    }
  }

  return { room, gameState, hand };
}

export function subscribeToRoomFirestore(
  roomId: string,
  onRoomUpdate: (room: RoomData) => void,
  onRoomClosed: () => void
): () => void {
  if (!auth.currentUser) return () => {};

  let latestRoomDoc: Record<string, unknown> | null = null;
  let latestPlayers: PlayerRecord[] = [];
  let hasRoom = false;
  let hasPlayers = false;

  const emitIfReady = () => {
    if (!hasRoom || !latestRoomDoc) return;
    if (latestRoomDoc.status === 'closed') {
      onRoomClosed();
      return;
    }
    const gameMode: GameMode = ['classic', 'flip', 'custom'].includes(
      String(latestRoomDoc.gameMode)
    )
      ? (latestRoomDoc.gameMode as GameMode)
      : 'classic';

    onRoomUpdate({
      roomId: String(latestRoomDoc.roomId || roomId),
      roomCode: String(latestRoomDoc.roomCode || ''),
      roomName: String(latestRoomDoc.roomName || 'UNO Arena Room'),
      hostId: String(latestRoomDoc.hostId || ''),
      privacy: 'private',
      gameMode,
      maxPlayers: Math.min(10, Math.max(2, Number(latestRoomDoc.maxPlayers || 10))),
      status: (['waiting', 'lobby', 'playing', 'finished', 'closed'].includes(
        String(latestRoomDoc.status)
      )
        ? latestRoomDoc.status
        : 'waiting') as RoomData['status'],
      customRules: resolveRulesForMode(
        gameMode,
        (latestRoomDoc.customRules as Partial<CustomRulesConfig>) || {}
      ),
      players: hasPlayers ? latestPlayers : [],
      createdAt: toMillis(latestRoomDoc.createdAt),
      updatedAt: toMillis(latestRoomDoc.updatedAt),
    });
  };

  const unsubRoom = onSnapshot(
    doc(db, 'rooms', roomId),
    (snap) => {
      if (!snap.exists()) {
        onRoomClosed();
        return;
      }
      latestRoomDoc = snap.data();
      hasRoom = true;
      emitIfReady();
    },
    (err) => {
      if (err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`);
      }
    }
  );

  const unsubPlayers = onSnapshot(
    query(collection(db, 'rooms', roomId, 'players'), orderBy('joinedAt', 'asc')),
    (snap) => {
      latestPlayers = snap.docs.map((pDoc) => {
        const p = pDoc.data();
        return {
          id: String(p.playerId || pDoc.id),
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
      });
      hasPlayers = true;
      emitIfReady();
    },
    (err) => {
      if (err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.LIST, `rooms/${roomId}/players`);
      }
    }
  );

  return () => {
    unsubRoom();
    unsubPlayers();
  };
}

export function subscribeToGameFirestore(
  roomId: string,
  uid: string,
  onGameUpdate: (gameState: PublicGameState | null) => void,
  onHandUpdate: (hand: UnoCard[]) => void
): () => void {
  if (!auth.currentUser || !uid) return () => {};

  const unsubState = onSnapshot(
    doc(db, 'rooms', roomId, 'game', 'state'),
    (snap) => {
      if (!snap.exists()) {
        onGameUpdate(null);
        return;
      }
      onGameUpdate(snap.data() as PublicGameState);
    },
    (err) => {
      if (err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, `rooms/${roomId}/game/state`);
      }
    }
  );

  const unsubHand = onSnapshot(
    doc(db, 'rooms', roomId, 'hands', uid),
    (snap) => {
      if (!snap.exists()) {
        onHandUpdate([]);
        return;
      }
      const data = snap.data();
      onHandUpdate(Array.isArray(data?.cards) ? (data.cards as UnoCard[]) : []);
    },
    (err) => {
      if (err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, `rooms/${roomId}/hands/${uid}`);
      }
    }
  );

  return () => {
    unsubState();
    unsubHand();
  };
}

export async function updatePlayerLobbyState(
  sessionToken: string,
  roomId: string,
  updates: { username?: string; avatar?: string; isReady?: boolean }
): Promise<{ room: RoomData }> {
  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    const fsUpdates: Record<string, unknown> = { lastSeen: serverTimestamp() };
    if (typeof updates.username === 'string' && updates.username.trim().length >= 2) {
      fsUpdates.username = normalizeUsername(updates.username, 'Player');
    }
    if (typeof updates.avatar === 'string' && updates.avatar.trim()) {
      fsUpdates.avatar = updates.avatar.trim().slice(0, 128);
    }
    if (typeof updates.isReady === 'boolean') {
      fsUpdates.isReady = updates.isReady;
    }
    try {
      await updateDoc(doc(db, 'rooms', roomId, 'players', firebaseUser.uid), fsUpdates);
    } catch (err) {
      if (!sessionToken) {
        throw mapFirebaseRoomError(err, `rooms/${roomId}/players/${firebaseUser.uid}`);
      }
    }
  }

  if (sessionToken) {
    try {
      return await apiRequest<{ room: RoomData }>(
        `/api/rooms/${encodeURIComponent(roomId)}/player`,
        sessionToken,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );
    } catch (err) {
      if (!firebaseUser) throw err;
    }
  }

  const room = await readRoomFromFirestore(roomId);
  return { room };
}

export async function updateRoomSettings(
  sessionToken: string,
  roomId: string,
  settings: {
    roomName?: string;
    gameMode?: GameMode;
    maxPlayers?: number;
    customRules?: Partial<CustomRulesConfig>;
  }
): Promise<{ room: RoomData }> {
  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    const fsUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (typeof settings.roomName === 'string' && settings.roomName.trim().length >= 2) {
      fsUpdates.roomName = settings.roomName.trim().slice(0, 40);
    }
    if (settings.gameMode && ['classic', 'flip', 'custom'].includes(settings.gameMode)) {
      fsUpdates.gameMode = settings.gameMode;
    }
    if (settings.maxPlayers !== undefined) {
      fsUpdates.maxPlayers = Math.min(10, Math.max(2, Math.round(Number(settings.maxPlayers))));
    }
    if (settings.customRules) {
      fsUpdates.customRules = settings.customRules;
    }
    try {
      await updateDoc(doc(db, 'rooms', roomId), fsUpdates);
    } catch (err) {
      if (!sessionToken) {
        throw mapFirebaseRoomError(err, `rooms/${roomId}`);
      }
    }
  }

  if (sessionToken) {
    try {
      return await apiRequest<{ room: RoomData }>(
        `/api/rooms/${encodeURIComponent(roomId)}/settings`,
        sessionToken,
        {
          method: 'PATCH',
          body: JSON.stringify(settings),
        }
      );
    } catch (err) {
      if (!firebaseUser) throw err;
    }
  }

  const room = await readRoomFromFirestore(roomId);
  return { room };
}

export async function kickPlayerFromRoom(
  sessionToken: string,
  roomId: string,
  playerId: string
): Promise<{ room: RoomData }> {
  if (auth.currentUser) {
    const roomRef = doc(db, 'rooms', roomId);
    const targetRef = doc(db, 'rooms', roomId, 'players', playerId);
    await runTransaction(db, async (tx) => {
      const targetSnap = await tx.get(targetRef);
      const roomSnap = await tx.get(roomRef);
      if (targetSnap.exists()) {
        tx.delete(targetRef);
        if (roomSnap.exists() && Number(roomSnap.data().playerCount || 0) > 0) {
          tx.update(roomRef, {
            playerCount: increment(-1),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }).catch(() => {});
  }
  if (sessionToken) {
    try {
      return await apiRequest<{ room: RoomData }>(
        `/api/rooms/${encodeURIComponent(roomId)}/kick`,
        sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({ playerId }),
        }
      );
    } catch (err) {
      if (!auth.currentUser) throw err;
    }
  }
  const room = await readRoomFromFirestore(roomId);
  return { room };
}

export async function leaveRoom(sessionToken: string, roomId: string): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!sessionToken && firebaseUser) {
    try {
      const roomSnap = await getDoc(doc(db, 'rooms', roomId));
      const status = roomSnap.exists() ? String(roomSnap.data()?.status || '') : '';
      if (status === 'playing' || status === 'finished') {
        await firebaseGameApiRequest('/api/game/leave', { roomId });
        return;
      }
    } catch {
      // Fall back to direct Firestore lobby leave below if match leave endpoint is unavailable
    }
  }

  if (firebaseUser) {
    const uid = firebaseUser.uid;
    try {
      const playersSnap = await getDocs(
        query(collection(db, 'rooms', roomId, 'players'), orderBy('joinedAt', 'asc'))
      );
      const nextHostId = playersSnap.docs.find((d) => d.id !== uid)?.id || null;
      const roomRef = doc(db, 'rooms', roomId);
      const playerRef = doc(db, 'rooms', roomId, 'players', uid);

      await runTransaction(db, async (tx) => {
        const roomSnap = await tx.get(roomRef);
        const playerSnap = await tx.get(playerRef);
        if (!roomSnap.exists() || !playerSnap.exists()) return;

        const roomData = roomSnap.data();
        if (roomData.status === 'closed') return;

        const currentCount = Number(roomData.playerCount || 1);
        tx.delete(playerRef);

        if (currentCount <= 1) {
          if (roomData.hostId === uid) {
            tx.update(roomRef, {
              status: 'closed',
              playerCount: 0,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.update(roomRef, {
              playerCount: increment(-1),
              updatedAt: serverTimestamp(),
            });
          }
          return;
        }

        if (roomData.hostId === uid && nextHostId) {
          tx.update(doc(db, 'rooms', roomId, 'players', nextHostId), {
            isHost: true,
            lastSeen: serverTimestamp(),
          });
          tx.update(roomRef, {
            hostId: nextHostId,
            playerCount: increment(-1),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(roomRef, {
            playerCount: increment(-1),
            updatedAt: serverTimestamp(),
          });
        }
      });
    } catch {
      await deleteDoc(doc(db, 'rooms', roomId, 'players', uid)).catch(() => {});
    }
  }
  if (sessionToken) {
    await apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/leave`, sessionToken, {
      method: 'POST',
    }).catch(() => {});
  }
}

export async function closeRoom(sessionToken: string, roomId: string): Promise<void> {
  if (auth.currentUser) {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'closed',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
  if (sessionToken) {
    await apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/close`, sessionToken, {
      method: 'POST',
    }).catch(() => {});
  }
}

export async function startRoomGame(
  sessionToken: string,
  roomId: string
): Promise<RoomStateResponse> {
  if (sessionToken) {
    return apiRequest<RoomStateResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/start`,
      sessionToken,
      { method: 'POST' }
    );
  }
  if (!auth.currentUser) {
    throw new Error('Authentication required. Please sign in before starting a match.');
  }
  return firebaseGameApiRequest<RoomStateResponse>('/api/game/start', { roomId });
}

export async function startNextRound(sessionToken: string, roomId: string): Promise<RoomStateResponse | void> {
  if (sessionToken) {
    await apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/next-round`, sessionToken, {
      method: 'POST',
    });
    return;
  }
  return firebaseGameApiRequest<RoomStateResponse>('/api/game/action', {
    roomId,
    actionType: 'next_round',
  });
}

export async function restartRoomGame(sessionToken: string, roomId: string): Promise<RoomStateResponse | void> {
  if (sessionToken) {
    await apiRequest(`/api/rooms/${encodeURIComponent(roomId)}/restart`, sessionToken, {
      method: 'POST',
    });
    return;
  }
  return firebaseGameApiRequest<RoomStateResponse>('/api/game/action', {
    roomId,
    actionType: 'restart',
  });
}

export async function returnRoomToLobby(
  sessionToken: string,
  roomId: string
): Promise<{ room: RoomData }> {
  if (sessionToken) {
    return apiRequest<{ room: RoomData }>(
      `/api/rooms/${encodeURIComponent(roomId)}/return-lobby`,
      sessionToken,
      { method: 'POST' }
    );
  }
  return firebaseGameApiRequest<{ room: RoomData }>('/api/game/action', {
    roomId,
    actionType: 'return_lobby',
  });
}
