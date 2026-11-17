import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  CardColor,
  CustomRulesConfig,
  GameMode,
  PlayerRecord,
  RoomData,
  ServerGameState,
  UnoCard,
} from './src/engine/gameTypes.ts';
import { resolveRulesForMode } from './src/engine/customRules.ts';
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
} from './src/engine/gameEngine.ts';

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface ManagedRoom {
  room: RoomData;
  game: ServerGameState | null;
}

const rooms = new Map<string, ManagedRoom>();
const codeToRoomId = new Map<string, string>();
const roomSockets = new Map<string, Map<string, Set<WebSocket>>>();
const lookupRateLimits = new Map<string, { count: number; resetAt: number }>();

function signUid(uid: string): string {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(uid).digest('hex');
  return `${uid}.${sig}`;
}

function verifySessionToken(token: string | undefined): string | null {
  if (!token || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const uid = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!uid || !sig || !/^[a-zA-Z0-9_-]{3,128}$/.test(uid)) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(uid).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return uid;
    }
  } catch {
    return null;
  }
  return null;
}

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!codeToRoomId.has(code)) {
      return code;
    }
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateRoomId(): string {
  return `room_${crypto.randomBytes(6).toString('hex')}`;
}

interface AuthedRequest extends Request {
  uid?: string;
}

function requireSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const uid = verifySessionToken(token);
  if (!uid) {
    res.status(401).json({ error: 'Authentication session required.' });
    return;
  }
  req.uid = uid;
  next();
}

function broadcastRoomState(roomId: string) {
  const entry = rooms.get(roomId);
  if (!entry) return;
  const clientsByPlayer = roomSockets.get(roomId);
  if (!clientsByPlayer) return;

  const publicGame = entry.game ? toPublicGameState(entry.game) : null;

  for (const [playerId, sockets] of clientsByPlayer.entries()) {
    const hand: UnoCard[] = entry.game?.hands[playerId] ?? [];
    const payload = JSON.stringify({
      type: 'state_sync',
      room: entry.room,
      gameState: publicGame,
      hand,
    });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

function sendErrorToSocket(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

function executeGameAction(
  entry: ManagedRoom,
  playerId: string,
  actionType: string,
  payload: Record<string, unknown>
) {
  if (!entry.game) {
    throw new GameEngineError('Game has not started yet.');
  }
  const actionId = typeof payload.actionId === 'string' ? payload.actionId : undefined;

  switch (actionType) {
    case 'play_cards': {
      const cardIds = Array.isArray(payload.cardIds) ? payload.cardIds.map(String) : [];
      const chosenColor = payload.chosenColor ? (String(payload.chosenColor) as CardColor) : undefined;
      playCardsAction(entry.game, playerId, cardIds, chosenColor, actionId);
      break;
    }
    case 'draw_card':
      drawCardAction(entry.game, playerId, actionId);
      break;
    case 'choose_color':
      chooseColorAction(entry.game, playerId, String(payload.color) as CardColor, actionId);
      break;
    case 'swap_hands':
      swapHandsAction(entry.game, playerId, String(payload.targetPlayerId), actionId);
      break;
    case 'challenge_wild4':
      challengeWild4Action(entry.game, playerId, Boolean(payload.challenge), actionId);
      break;
    case 'call_uno':
      callUnoAction(entry.game, playerId, actionId);
      break;
    case 'catch_uno':
      catchUnoAction(entry.game, playerId, String(payload.targetPlayerId), actionId);
      break;
    case 'pass_turn':
      passTurnAction(entry.game, playerId, actionId);
      break;
    default:
      throw new GameEngineError(`Unsupported action: ${actionType}`);
  }

  entry.room.updatedAt = Date.now();
  if (entry.game.gameStatus === 'finished') {
    entry.room.status = 'finished';
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Auth Session endpoint (supports Firebase UID verification bridge & guest fallback)
  app.post('/api/auth/session', (req: Request, res: Response) => {
    const requestedUid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
    const isGuestFallback = Boolean(req.body?.guestFallback);
    let uid = requestedUid;

    if (!uid || isGuestFallback) {
      uid = requestedUid && /^[a-zA-Z0-9_-]{4,128}$/.test(requestedUid)
        ? requestedUid
        : `guest_${crypto.randomBytes(8).toString('hex')}`;
    }

    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(uid)) {
      res.status(400).json({ error: 'Invalid user identifier.' });
      return;
    }

    const sessionToken = signUid(uid);
    res.json({ uid, sessionToken });
  });

  // Create private room (or register/hydrate a Firestore-created room)
  app.post('/api/rooms', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const roomName = String(req.body?.roomName || 'UNO Arena Room').trim().slice(0, 40);
    if (roomName.length < 2) {
      res.status(400).json({ error: 'Room name must be at least 2 characters.' });
      return;
    }

    const gameMode: GameMode = ['classic', 'flip', 'custom'].includes(req.body?.gameMode)
      ? req.body.gameMode
      : 'classic';
    const maxPlayers = Math.min(10, Math.max(2, Number(req.body?.maxPlayers || 10)));
    const username = String(req.body?.username || 'Host').trim().slice(0, 24) || 'Host';
    const avatar = String(req.body?.avatar || 'crimson').slice(0, 128);
    const customRules = resolveRulesForMode(
      gameMode,
      (req.body?.customRules as Partial<CustomRulesConfig>) || {}
    );

    const requestedRoomId =
      typeof req.body?.roomId === 'string' && /^[a-zA-Z0-9_-]{3,128}$/.test(req.body.roomId)
        ? req.body.roomId
        : null;
    const requestedRoomCode =
      typeof req.body?.roomCode === 'string' && /^[A-Z0-9]{6}$/.test(req.body.roomCode.toUpperCase())
        ? req.body.roomCode.toUpperCase()
        : null;

    if (requestedRoomId && rooms.has(requestedRoomId)) {
      const existing = rooms.get(requestedRoomId)!;
      if (existing.room.hostId === uid || existing.room.players.some((p) => p.id === uid)) {
        res.status(200).json({
          success: true,
          roomId: existing.room.roomId,
          roomCode: existing.room.roomCode,
          roomName: existing.room.roomName,
          hostId: existing.room.hostId,
          gameMode: existing.room.gameMode,
          maxPlayers: existing.room.maxPlayers,
          status: existing.room.status,
          room: existing.room,
        });
        return;
      }
    }

    if (requestedRoomCode && codeToRoomId.has(requestedRoomCode)) {
      res.status(409).json({ error: 'Room code already in use. Please try again.' });
      return;
    }

    const roomId = requestedRoomId || generateRoomId();
    const roomCode = requestedRoomCode || generateRoomCode();
    const now = Date.now();

    const incomingPlayers = Array.isArray(req.body?.players)
      ? (req.body.players as PlayerRecord[]).filter(
          (p) => p && typeof p.id === 'string' && typeof p.username === 'string'
        )
      : null;

    const hostPlayer: PlayerRecord = {
      id: uid,
      username,
      avatar,
      isHost: true,
      isReady: true,
      isSpectator: false,
      connectionStatus: 'online',
      joinedAt: now,
      lastSeen: now,
    };

    const room: RoomData = {
      roomId,
      roomCode,
      roomName,
      hostId: typeof req.body?.hostId === 'string' && /^[a-zA-Z0-9_-]{3,128}$/.test(req.body.hostId)
        ? req.body.hostId
        : uid,
      privacy: 'private',
      gameMode,
      maxPlayers,
      status: 'waiting',
      customRules,
      players: incomingPlayers && incomingPlayers.length > 0 ? incomingPlayers : [hostPlayer],
      createdAt: now,
      updatedAt: now,
    };

    rooms.set(roomId, { room, game: null });
    codeToRoomId.set(roomCode, roomId);

    res.status(201).json({
      success: true,
      roomId: room.roomId,
      roomCode: room.roomCode,
      roomName: room.roomName,
      hostId: room.hostId,
      gameMode: room.gameMode,
      maxPlayers: room.maxPlayers,
      status: room.status,
      room,
    });
  });

  // Exact room code lookup (Private rooms only — rate limited)
  app.get('/api/rooms/lookup/:code', requireSession, (req: AuthedRequest, res: Response) => {
    const ip = req.ip || req.uid || 'unknown';
    const now = Date.now();
    const rl = lookupRateLimits.get(ip);
    if (rl && rl.resetAt > now) {
      if (rl.count >= 20) {
        res.status(429).json({ error: 'Too many room code attempts. Please wait a moment.' });
        return;
      }
      rl.count += 1;
    } else {
      lookupRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    }

    const code = String(req.params.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      res.status(400).json({ error: 'Room code must be 6 letters or numbers.' });
      return;
    }

    const roomId = codeToRoomId.get(code);
    if (!roomId) {
      res.status(404).json({ error: 'Private room not found. Check your 6-character code.' });
      return;
    }

    const entry = rooms.get(roomId);
    if (!entry || entry.room.status === 'closed') {
      res.status(404).json({ error: 'This private room is no longer active.' });
      return;
    }

    const r = entry.room;
    res.json({
      roomId: r.roomId,
      roomCode: r.roomCode,
      roomName: r.roomName,
      gameMode: r.gameMode,
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers,
      status: r.status,
      allowLateJoining: r.customRules.allowLateJoining,
      allowSpectators: r.customRules.allowSpectators,
    });
  });

  // Join room (by roomId or roomCode)
  app.post('/api/rooms/:roomIdOrCode/join', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const raw = String(req.params.roomIdOrCode || '').trim();
    const roomId = codeToRoomId.get(raw.toUpperCase()) || raw;
    const entry = rooms.get(roomId);

    if (!entry || entry.room.status === 'closed') {
      res.status(404).json({ error: 'Room not found or already closed.' });
      return;
    }

    const { room } = entry;
    const username = String(req.body?.username || 'Player').trim().slice(0, 24) || 'Player';
    const avatar = String(req.body?.avatar || 'cobalt').slice(0, 128);
    const asSpectator = Boolean(req.body?.asSpectator);
    const now = Date.now();

    const existing = room.players.find((p) => p.id === uid);
    if (existing) {
      existing.connectionStatus = 'online';
      existing.lastSeen = now;
      if (room.status === 'waiting' || room.status === 'lobby') {
        existing.username = username;
        existing.avatar = avatar;
      }
      if (entry.game) {
        const gp = entry.game.players.find((p) => p.id === uid);
        if (gp) {
          gp.connectionStatus = 'online';
          gp.lastSeen = now;
        }
      }
      room.updatedAt = now;
      broadcastRoomState(room.roomId);
      res.json({
        room,
        gameState: entry.game ? toPublicGameState(entry.game) : null,
        hand: entry.game?.hands[uid] ?? [],
      });
      return;
    }

    if (asSpectator && !room.customRules.allowSpectators) {
      res.status(403).json({ error: 'Spectators are disabled in this room.' });
      return;
    }

    if (room.status === 'playing' && !room.customRules.allowLateJoining && !asSpectator) {
      res.status(409).json({ error: 'Game has already started and late joining is disabled.' });
      return;
    }

    const activeCount = room.players.filter((p) => !p.isSpectator).length;
    if (!asSpectator && activeCount >= room.maxPlayers) {
      res.status(409).json({ error: 'This room is already full.' });
      return;
    }

    const newPlayer: PlayerRecord = {
      id: uid,
      username,
      avatar,
      isHost: false,
      isReady: room.status === 'playing',
      isSpectator: asSpectator,
      connectionStatus: 'online',
      joinedAt: now,
      lastSeen: now,
    };

    room.players.push(newPlayer);
    room.updatedAt = now;

    if (entry.game) {
      entry.game.players.push(newPlayer);
      if (!asSpectator) {
        // Late joiner draws startingHandSize cards
        const hand: UnoCard[] = [];
        for (let i = 0; i < entry.game.rules.startingHandSize; i++) {
          const c = entry.game.drawPile.pop();
          if (c) hand.push(c);
        }
        entry.game.hands[uid] = hand;
        entry.game.scores[uid] = 0;
        entry.game.calledUno[uid] = false;
        entry.game.unoVulnerable[uid] = false;
      }
    }

    broadcastRoomState(room.roomId);
    res.json({
      room,
      gameState: entry.game ? toPublicGameState(entry.game) : null,
      hand: entry.game?.hands[uid] ?? [],
    });
  });

  // Fetch state (for reconnection / reload)
  app.get('/api/rooms/:roomId/state', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const roomId = String(req.params.roomId);
    const entry = rooms.get(roomId);
    if (!entry || entry.room.status === 'closed') {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    const member = entry.room.players.find((p) => p.id === uid);
    if (!member) {
      res.status(403).json({ error: 'You are not a member of this room.' });
      return;
    }
    member.connectionStatus = 'online';
    member.lastSeen = Date.now();
    res.json({
      room: entry.room,
      gameState: entry.game ? toPublicGameState(entry.game) : null,
      hand: entry.game?.hands[uid] ?? [],
    });
  });

  // Update player profile/ready in lobby
  app.patch('/api/rooms/:roomId/player', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    const player = entry.room.players.find((p) => p.id === uid);
    if (!player) {
      res.status(403).json({ error: 'Not a room member.' });
      return;
    }
    if (typeof req.body?.username === 'string' && req.body.username.trim().length >= 2) {
      player.username = req.body.username.trim().slice(0, 24);
    }
    if (typeof req.body?.avatar === 'string') {
      player.avatar = req.body.avatar.slice(0, 128);
    }
    if (typeof req.body?.isReady === 'boolean') {
      player.isReady = req.body.isReady;
    }
    player.lastSeen = Date.now();
    entry.room.updatedAt = Date.now();
    broadcastRoomState(entry.room.roomId);
    res.json({ room: entry.room });
  });

  // Update room settings (Host only, lobby only)
  app.patch('/api/rooms/:roomId/settings', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can change room settings.' });
      return;
    }
    if (entry.room.status !== 'waiting' && entry.room.status !== 'lobby') {
      res.status(409).json({ error: 'Cannot change settings after the game has started.' });
      return;
    }

    if (typeof req.body?.roomName === 'string' && req.body.roomName.trim().length >= 2) {
      entry.room.roomName = req.body.roomName.trim().slice(0, 40);
    }
    if (['classic', 'flip', 'custom'].includes(req.body?.gameMode)) {
      entry.room.gameMode = req.body.gameMode;
    }
    if (req.body?.maxPlayers !== undefined) {
      const nextMax = Math.min(10, Math.max(2, Number(req.body.maxPlayers)));
      if (nextMax >= entry.room.players.length) {
        entry.room.maxPlayers = nextMax;
      }
    }
    if (req.body?.customRules) {
      entry.room.customRules = resolveRulesForMode(entry.room.gameMode, {
        ...entry.room.customRules,
        ...req.body.customRules,
      });
    } else {
      entry.room.customRules = resolveRulesForMode(entry.room.gameMode, entry.room.customRules);
    }

    entry.room.updatedAt = Date.now();
    broadcastRoomState(entry.room.roomId);
    res.json({ room: entry.room });
  });

  // Kick player (Host only)
  app.post('/api/rooms/:roomId/kick', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can remove players.' });
      return;
    }
    const targetId = String(req.body?.playerId || '');
    if (targetId === uid) {
      res.status(400).json({ error: 'Host cannot kick themselves.' });
      return;
    }
    entry.room.players = entry.room.players.filter((p) => p.id !== targetId);
    if (entry.game) {
      entry.game.players = entry.game.players.filter((p) => p.id !== targetId);
      delete entry.game.hands[targetId];
    }

    // Notify kicked sockets
    const kickedSockets = roomSockets.get(entry.room.roomId)?.get(targetId);
    if (kickedSockets) {
      for (const ws of kickedSockets) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'kicked', message: 'You were removed from the room by the host.' }));
        }
      }
      roomSockets.get(entry.room.roomId)?.delete(targetId);
    }

    entry.room.updatedAt = Date.now();
    broadcastRoomState(entry.room.roomId);
    res.json({ room: entry.room });
  });

  // Leave room (with automatic host transfer & clean game adjustment)
  app.post('/api/rooms/:roomId/leave', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const roomId = String(req.params.roomId);
    const entry = rooms.get(roomId);
    if (!entry) {
      res.json({ ok: true });
      return;
    }

    const { room } = entry;
    room.players = room.players.filter((p) => p.id !== uid);
    roomSockets.get(roomId)?.delete(uid);

    if (room.players.length === 0) {
      room.status = 'closed';
      codeToRoomId.delete(room.roomCode);
      rooms.delete(roomId);
      res.json({ ok: true });
      return;
    }

    if (room.hostId === uid) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
      room.players[0].isReady = true;
    }

    if (entry.game) {
      const wasCurrentTurn = entry.game.currentPlayerId === uid;
      const activeBefore = entry.game.players.filter((p) => !p.isSpectator);
      const nextIdx = activeBefore.findIndex((p) => p.id === uid);
      entry.game.players = entry.game.players.filter((p) => p.id !== uid);
      const returnedCards = entry.game.hands[uid] ?? [];
      entry.game.drawPile.unshift(...returnedCards);
      delete entry.game.hands[uid];

      const activeRemaining = entry.game.players.filter((p) => !p.isSpectator);
      if (activeRemaining.length < 2 && entry.game.gameStatus === 'playing') {
        entry.game.gameStatus = 'finished';
        entry.game.winnerId = activeRemaining[0]?.id ?? null;
        entry.room.status = 'finished';
      } else if (wasCurrentTurn && activeRemaining.length > 0) {
        const fallback = activeRemaining[Math.max(0, nextIdx % activeRemaining.length)];
        entry.game.currentPlayerId = fallback.id;
      }
    }

    room.updatedAt = Date.now();
    broadcastRoomState(roomId);
    res.json({ ok: true });
  });

  // Close room (Host only)
  app.post('/api/rooms/:roomId/close', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const roomId = String(req.params.roomId);
    const entry = rooms.get(roomId);
    if (!entry) {
      res.json({ ok: true });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can close the room.' });
      return;
    }
    entry.room.status = 'closed';
    const socketsMap = roomSockets.get(roomId);
    if (socketsMap) {
      for (const sockets of socketsMap.values()) {
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'room_closed', message: 'The host closed this room.' }));
          }
        }
      }
      roomSockets.delete(roomId);
    }
    codeToRoomId.delete(entry.room.roomCode);
    rooms.delete(roomId);
    res.json({ ok: true });
  });

  // Start game (Host only)
  app.post('/api/rooms/:roomId/start', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can start the game.' });
      return;
    }
    const activePlayers = entry.room.players.filter((p) => !p.isSpectator);
    if (activePlayers.length < 2) {
      res.status(400).json({ error: 'At least 2 players must join before starting.' });
      return;
    }

    try {
      entry.game = createInitialGameState(
        entry.room.roomId,
        entry.room.gameMode,
        entry.room.customRules,
        entry.room.players
      );
      entry.room.status = 'playing';
      entry.room.updatedAt = Date.now();
      broadcastRoomState(entry.room.roomId);
      res.json({
        room: entry.room,
        gameState: toPublicGameState(entry.game),
        hand: entry.game.hands[uid] ?? [],
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start game.' });
    }
  });

  // Next round (Host only)
  app.post('/api/rooms/:roomId/next-round', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry || !entry.game) {
      res.status(404).json({ error: 'Active game not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can start the next round.' });
      return;
    }
    try {
      entry.game = startNextRoundAction(entry.game);
      entry.room.status = 'playing';
      entry.room.updatedAt = Date.now();
      broadcastRoomState(entry.room.roomId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot start next round.' });
    }
  });

  // Play again with same room settings (Host only)
  app.post('/api/rooms/:roomId/restart', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can restart the match.' });
      return;
    }
    try {
      entry.game = createInitialGameState(
        entry.room.roomId,
        entry.room.gameMode,
        entry.room.customRules,
        entry.room.players
      );
      entry.room.status = 'playing';
      entry.room.updatedAt = Date.now();
      broadcastRoomState(entry.room.roomId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot restart game.' });
    }
  });

  // Return to lobby (Host only)
  app.post('/api/rooms/:roomId/return-lobby', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (entry.room.hostId !== uid) {
      res.status(403).json({ error: 'Only the host can return the room to lobby.' });
      return;
    }
    entry.game = null;
    entry.room.status = 'waiting';
    for (const p of entry.room.players) {
      p.isReady = p.isHost;
    }
    entry.room.updatedAt = Date.now();
    broadcastRoomState(entry.room.roomId);
    res.json({ room: entry.room });
  });

  // Submit authoritative game action over REST (fallback / idempotent)
  app.post('/api/rooms/:roomId/action', requireSession, (req: AuthedRequest, res: Response) => {
    const uid = req.uid!;
    const entry = rooms.get(String(req.params.roomId));
    if (!entry) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    const member = entry.room.players.find((p) => p.id === uid && !p.isSpectator);
    if (!member) {
      res.status(403).json({ error: 'Only active room players can perform game actions.' });
      return;
    }
    try {
      executeGameAction(entry, uid, String(req.body?.actionType || ''), req.body || {});
      broadcastRoomState(entry.room.roomId);
      res.json({
        gameState: entry.game ? toPublicGameState(entry.game) : null,
        hand: entry.game?.hands[uid] ?? [],
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid move.' });
    }
  });

  // Vite or static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token') || undefined;
    const roomId = url.searchParams.get('roomId') || '';
    const uid = verifySessionToken(token);

    if (!uid || !roomId) {
      sendErrorToSocket(ws, 'Unauthorized WebSocket connection.');
      ws.close();
      return;
    }

    const entry = rooms.get(roomId);
    if (!entry || !entry.room.players.some((p) => p.id === uid)) {
      sendErrorToSocket(ws, 'Room not found or access denied.');
      ws.close();
      return;
    }

    if (!roomSockets.has(roomId)) {
      roomSockets.set(roomId, new Map());
    }
    const playersMap = roomSockets.get(roomId)!;
    if (!playersMap.has(uid)) {
      playersMap.set(uid, new Set());
    }
    playersMap.get(uid)!.add(ws);

    const player = entry.room.players.find((p) => p.id === uid);
    if (player) {
      player.connectionStatus = 'online';
      player.lastSeen = Date.now();
    }
    if (entry.game) {
      const gp = entry.game.players.find((p) => p.id === uid);
      if (gp) {
        gp.connectionStatus = 'online';
        gp.lastSeen = Date.now();
      }
    }

    // Immediate initial sync for connecting player + broadcast presence
    broadcastRoomState(roomId);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const liveEntry = rooms.get(roomId);
        if (!liveEntry) return;

        if (msg.type === 'heartbeat') {
          const p = liveEntry.room.players.find((pl) => pl.id === uid);
          if (p) {
            p.lastSeen = Date.now();
            p.connectionStatus = 'online';
          }
          if (liveEntry.game) {
            const gp = liveEntry.game.players.find((pl) => pl.id === uid);
            if (gp) {
              gp.lastSeen = Date.now();
              gp.connectionStatus = 'online';
            }
          }
          return;
        }

        if (msg.type === 'action') {
          const member = liveEntry.room.players.find((p) => p.id === uid && !p.isSpectator);
          if (!member) {
            sendErrorToSocket(ws, 'Spectators cannot perform game actions.');
            return;
          }
          executeGameAction(liveEntry, uid, String(msg.actionType || ''), msg);
          broadcastRoomState(roomId);
        }
      } catch (err) {
        sendErrorToSocket(ws, err instanceof Error ? err.message : 'Action rejected.');
      }
    });

    ws.on('close', () => {
      const map = roomSockets.get(roomId);
      if (map) {
        const set = map.get(uid);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            map.delete(uid);
            const liveEntry = rooms.get(roomId);
            if (liveEntry) {
              const p = liveEntry.room.players.find((pl) => pl.id === uid);
              if (p) p.connectionStatus = 'reconnecting';
              if (liveEntry.game) {
                const gp = liveEntry.game.players.find((pl) => pl.id === uid);
                if (gp) gp.connectionStatus = 'reconnecting';
              }
              broadcastRoomState(roomId);
            }
          }
        }
      }
    });
  });

  // Authoritative 1s loop: turn timers + presence + stale room cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [roomId, entry] of rooms.entries()) {
      let changed = false;

      if (entry.game && entry.game.gameStatus === 'playing' && entry.game.turnExpiresAt) {
        if (now >= entry.game.turnExpiresAt) {
          try {
            handleTurnTimeout(entry.game);
            changed = true;
          } catch {
            // ignore transient timeout errors
          }
        }
      }

      for (const p of entry.room.players) {
        const age = now - p.lastSeen;
        const nextStatus = age > 60_000 ? 'offline' : age > 20_000 ? 'reconnecting' : 'online';
        if (p.connectionStatus !== nextStatus) {
          p.connectionStatus = nextStatus;
          if (entry.game) {
            const gp = entry.game.players.find((pl) => pl.id === p.id);
            if (gp) gp.connectionStatus = nextStatus;
          }
          changed = true;
        }
      }

      if (changed) {
        broadcastRoomState(roomId);
      }

      // Clean up stale rooms older than 6 hours
      if (now - entry.room.updatedAt > 6 * 60 * 60 * 1000) {
        codeToRoomId.delete(entry.room.roomCode);
        rooms.delete(roomId);
        roomSockets.delete(roomId);
      }
    }
  }, 1000);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`UNO ARENA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
