import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { isValidId, requireAuth } from './auth';
import { createDeckForMode, GameMode, getCardFace, LIGHT_COLORS, DARK_COLORS, UnoCard } from './gameEngine';

export const startGame = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = admin.firestore();
  const roomId = (request.data as Record<string, unknown>).roomId;
  if (!isValidId(roomId)) throw new HttpsError('invalid-argument', 'Invalid roomId.');

  const roomRef = db.collection('rooms').doc(roomId);
  await db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found.');
    const room = roomSnap.data()!;
    if (room.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host can start the game.');

    const playersSnap = await tx.get(roomRef.collection('players').orderBy('joinedAt', 'asc'));
    if (playersSnap.size < 2) throw new HttpsError('failed-precondition', 'Need at least 2 players to start.');

    const mode = room.gameMode as GameMode;
    const handSize = Number(room.customRules?.startingHandSize || 7);
    const deck = createDeckForMode(mode);

    const playerIds = playersSnap.docs.map((d) => d.id);
    const hands: Record<string, UnoCard[]> = {};
    for (const pid of playerIds) {
      hands[pid] = deck.splice(0, handSize);
    }

    let starterIdx = deck.findIndex((c) => c.light.color !== 'wild');
    if (starterIdx === -1) starterIdx = 0;
    const [topCard] = deck.splice(starterIdx, 1);
    const now = admin.firestore.FieldValue.serverTimestamp();

    tx.update(roomRef, { status: 'playing', updatedAt: now });
    tx.set(roomRef.collection('game').doc('state'), {
      roomId,
      currentPlayerId: playerIds[0],
      currentDirection: 1,
      currentColor: topCard.light.color === 'wild' ? 'red' : topCard.light.color,
      currentSide: 'light',
      discardTopCard: topCard,
      drawPileCount: deck.length,
      gameStatus: 'playing',
      roundNumber: 1,
      winnerId: '',
      lastAction: 'Game started',
      updatedAt: now,
    });
    tx.set(roomRef.collection('secret').doc('state'), {
      drawPile: deck,
      discardPile: [topCard],
      updatedAt: now,
    });
    for (const doc of playersSnap.docs) {
      tx.set(roomRef.collection('hands').doc(doc.id), {
        playerId: doc.id,
        cards: hands[doc.id],
        updatedAt: now,
      });
      tx.update(doc.ref, { cardCount: hands[doc.id].length });
    }
  });

  return { ok: true };
});

export const submitGameAction = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = admin.firestore();
  const data = request.data as Record<string, unknown>;
  const roomId = data.roomId;
  const actionType = String(data.actionType || '');
  const actionId = String(data.actionId || `${Date.now()}_${uid}`);

  if (!isValidId(roomId)) throw new HttpsError('invalid-argument', 'Invalid roomId.');

  const roomRef = db.collection('rooms').doc(roomId);
  const stateRef = roomRef.collection('game').doc('state');
  const secretRef = roomRef.collection('secret').doc('state');
  const actionRef = roomRef.collection('actions').doc(actionId);

  await db.runTransaction(async (tx) => {
    const existingAction = await tx.get(actionRef);
    if (existingAction.exists) return;

    const [roomSnap, stateSnap, secretSnap, playersSnap] = await Promise.all([
      tx.get(roomRef),
      tx.get(stateRef),
      tx.get(secretRef),
      tx.get(roomRef.collection('players').orderBy('joinedAt', 'asc')),
    ]);

    if (!roomSnap.exists || !stateSnap.exists || !secretSnap.exists) {
      throw new HttpsError('not-found', 'Active game not found.');
    }

    const memberIds = playersSnap.docs.map((d) => d.id);
    if (!memberIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'Not a member of this room.');
    }

    const state = stateSnap.data()!;
    const secret = secretSnap.data()!;
    const drawPile: UnoCard[] = [...(secret.drawPile || [])];
    const discardPile: UnoCard[] = [...(secret.discardPile || [])];
    const side = (state.currentSide || 'light') as 'light' | 'dark';
    const now = admin.firestore.FieldValue.serverTimestamp();

    const handRef = roomRef.collection('hands').doc(uid);
    const handSnap = await tx.get(handRef);
    const hand: UnoCard[] = [...(handSnap.data()?.cards || [])];

    if (actionType === 'play_card') {
      if (state.currentPlayerId !== uid) {
        throw new HttpsError('failed-precondition', 'Not your turn.');
      }
      const cardId = String(data.cardId || '');
      const idx = hand.findIndex((c) => c.id === cardId);
      if (idx === -1) throw new HttpsError('invalid-argument', 'Card not in hand.');
      const card = hand[idx];
      const face = getCardFace(card, side);
      const top = discardPile[discardPile.length - 1];
      const topFace = getCardFace(top, side);

      if (face.color !== 'wild' && face.color !== state.currentColor && face.value !== topFace.value) {
        throw new HttpsError('failed-precondition', 'Card does not match color or value.');
      }

      hand.splice(idx, 1);
      discardPile.push(card);

      let nextColor = face.color === 'wild' ? String(data.chosenColor || (side === 'light' ? LIGHT_COLORS[0] : DARK_COLORS[0])) : face.color;
      let nextDirection = Number(state.currentDirection || 1);
      let nextSide = side;
      let steps = 1;

      if (face.value === 'reverse') {
        nextDirection *= -1;
        if (memberIds.length === 2) steps = 2;
      } else if (face.value === 'skip') {
        steps = 2;
      } else if (face.value === 'skip_everyone') {
        steps = 0;
      } else if (face.value === 'flip') {
        nextSide = side === 'light' ? 'dark' : 'light';
        const flippedFace = getCardFace(card, nextSide);
        nextColor = flippedFace.color === 'wild' ? (nextSide === 'light' ? 'red' : 'pink') : flippedFace.color;
      }

      const curIdx = memberIds.indexOf(uid);
      const nextIdx = ((curIdx + nextDirection * steps) % memberIds.length + memberIds.length) % memberIds.length;
      const winnerId = hand.length === 0 ? uid : '';

      tx.set(handRef, { playerId: uid, cards: hand, updatedAt: now });
      tx.update(roomRef.collection('players').doc(uid), { cardCount: hand.length });
      tx.set(secretRef, { drawPile, discardPile, updatedAt: now });
      tx.update(stateRef, {
        currentPlayerId: memberIds[nextIdx],
        currentDirection: nextDirection,
        currentColor: nextColor,
        currentSide: nextSide,
        discardTopCard: card,
        drawPileCount: drawPile.length,
        gameStatus: winnerId ? 'finished' : 'playing',
        winnerId,
        lastAction: `${uid} played ${face.color} ${face.value}`,
        updatedAt: now,
      });
    } else if (actionType === 'draw_card') {
      if (state.currentPlayerId !== uid) throw new HttpsError('failed-precondition', 'Not your turn.');
      const drawn = drawPile.pop();
      if (drawn) hand.push(drawn);
      const curIdx = memberIds.indexOf(uid);
      const dir = Number(state.currentDirection || 1);
      const nextIdx = ((curIdx + dir) % memberIds.length + memberIds.length) % memberIds.length;

      tx.set(handRef, { playerId: uid, cards: hand, updatedAt: now });
      tx.update(roomRef.collection('players').doc(uid), { cardCount: hand.length });
      tx.set(secretRef, { drawPile, discardPile, updatedAt: now });
      tx.update(stateRef, {
        currentPlayerId: memberIds[nextIdx],
        drawPileCount: drawPile.length,
        lastAction: `${uid} drew a card`,
        updatedAt: now,
      });
    }

    tx.set(actionRef, {
      actionId,
      playerId: uid,
      actionType,
      details: JSON.stringify(data).slice(0, 240),
      timestamp: now,
    });
  });

  return { ok: true };
});
