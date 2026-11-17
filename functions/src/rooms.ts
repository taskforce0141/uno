import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { isValidId, isValidRoomCode, requireAuth } from './auth';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return out;
}

export const createPrivateRoom = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = admin.firestore();
  const data = (request.data || {}) as Record<string, unknown>;

  const roomName = String(data.roomName || 'UNO Arena Room').trim().slice(0, 40);
  if (roomName.length < 2) {
    throw new HttpsError('invalid-argument', 'Room name must be at least 2 characters.');
  }

  const gameMode = ['classic', 'flip', 'custom'].includes(String(data.gameMode))
    ? String(data.gameMode)
    : 'classic';
  const maxPlayers = Math.min(10, Math.max(2, Math.round(Number(data.maxPlayers || 10))));
  let username = String(data.username || 'Host').trim().slice(0, 24);
  if (username.length < 2) username = 'Host';
  const avatar = String(data.avatar || 'crimson').slice(0, 128) || 'crimson';
  const customRules = (data.customRules as Record<string, unknown>) || {};

  const roomRef = db.collection('rooms').doc();
  const roomId = roomRef.id;
  let finalRoomCode = '';

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidateCode = generateRoomCode();
    try {
      await db.runTransaction(async (tx) => {
        const codeRef = db.collection('roomCodes').doc(candidateCode);
        const existingCode = await tx.get(codeRef);
        if (existingCode.exists) {
          throw new Error('ROOM_CODE_COLLISION');
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        tx.set(roomRef, {
          roomId,
          roomCode: candidateCode,
          roomName,
          hostId: uid,
          privacy: 'private',
          gameMode,
          maxPlayers,
          playerCount: 1,
          status: 'waiting',
          customRules,
          createdAt: now,
          updatedAt: now,
        });
        tx.set(codeRef, {
          roomCode: candidateCode,
          roomId,
          hostId: uid,
          createdAt: now,
        });
        tx.set(roomRef.collection('players').doc(uid), {
          playerId: uid,
          roomId,
          username,
          avatar,
          isHost: true,
          isReady: true,
          cardCount: 0,
          connectionStatus: 'online',
          joinedAt: now,
          lastSeen: now,
        });
      });
      finalRoomCode = candidateCode;
      break;
    } catch (err) {
      if (err instanceof Error && err.message === 'ROOM_CODE_COLLISION') {
        continue;
      }
      throw err;
    }
  }

  if (!finalRoomCode) {
    throw new HttpsError('already-exists', 'Failed to allocate a unique room code. Please try again.');
  }

  return {
    success: true,
    roomId,
    roomCode: finalRoomCode,
    roomName,
    hostId: uid,
    gameMode,
    maxPlayers,
    status: 'waiting',
  };
});

export const joinPrivateRoom = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = admin.firestore();
  const data = request.data as Record<string, unknown>;
  const roomCode = String(data.roomCode || '').trim().toUpperCase();
  const username = String(data.username || 'Player').trim().slice(0, 24);
  const avatar = String(data.avatar || 'cobalt').slice(0, 128);

  if (!isValidRoomCode(roomCode)) {
    throw new HttpsError('invalid-argument', 'Enter a valid 6-character room code.');
  }

  const codeSnap = await db.collection('roomCodes').doc(roomCode).get();
  if (!codeSnap.exists) {
    throw new HttpsError('not-found', 'Private room code not found.');
  }
  const roomId = codeSnap.data()!.roomId as string;
  const roomRef = db.collection('rooms').doc(roomId);

  await db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) {
      throw new HttpsError('not-found', 'Room no longer exists.');
    }
    const room = roomSnap.data()!;
    if (room.status === 'closed') {
      throw new HttpsError('failed-precondition', 'This room has been closed.');
    }

    const playerRef = roomRef.collection('players').doc(uid);
    const existingPlayer = await tx.get(playerRef);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (existingPlayer.exists) {
      tx.update(playerRef, {
        connectionStatus: 'online',
        lastSeen: now,
      });
      return;
    }

    const allowLateJoin = Boolean(room.customRules?.allowLateJoining);
    if (room.status === 'playing' && !allowLateJoin) {
      throw new HttpsError('failed-precondition', 'Game already started and late joining is disabled.');
    }
    if (Number(room.playerCount) >= Number(room.maxPlayers)) {
      throw new HttpsError('resource-exhausted', 'Room is full.');
    }

    tx.set(playerRef, {
      playerId: uid,
      roomId,
      username,
      avatar,
      isHost: false,
      isReady: false,
      cardCount: 0,
      connectionStatus: 'online',
      joinedAt: now,
      lastSeen: now,
    });
    tx.update(roomRef, {
      playerCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    });
  });

  return { roomId, roomCode };
});

export const leavePrivateRoom = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = admin.firestore();
  const roomId = (request.data as Record<string, unknown>).roomId;
  if (!isValidId(roomId)) {
    throw new HttpsError('invalid-argument', 'Invalid roomId.');
  }

  const roomRef = db.collection('rooms').doc(roomId);
  await db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) return;
    const room = roomSnap.data()!;
    const playersSnap = await tx.get(roomRef.collection('players').orderBy('joinedAt', 'asc'));
    const remaining = playersSnap.docs.filter((d) => d.id !== uid);

    tx.delete(roomRef.collection('players').doc(uid));
    tx.delete(roomRef.collection('game').doc('hands').collection('items').doc(uid));

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (remaining.length === 0) {
      tx.update(roomRef, { status: 'closed', playerCount: 0, updatedAt: now });
      return;
    }

    const updates: Record<string, unknown> = {
      playerCount: remaining.length,
      updatedAt: now,
    };
    if (room.hostId === uid) {
      const nextHost = remaining[0];
      updates.hostId = nextHost.id;
      tx.update(nextHost.ref, { isHost: true });
    }
    tx.update(roomRef, updates);
  });

  return { ok: true };
});
