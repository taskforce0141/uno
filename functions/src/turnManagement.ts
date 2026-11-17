import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

export const enforceTurnTimers = onSchedule('every 1 minutes', async () => {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 90_000);
  const activeRooms = await db
    .collection('rooms')
    .where('status', '==', 'playing')
    .where('updatedAt', '<', cutoff)
    .limit(25)
    .get();

  for (const roomDoc of activeRooms.docs) {
    const stateRef = roomDoc.ref.collection('game').doc('state');
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) continue;
    const state = stateSnap.data()!;
    const playersSnap = await roomDoc.ref.collection('players').orderBy('joinedAt', 'asc').get();
    const ids = playersSnap.docs.map((d) => d.id);
    if (ids.length < 2) continue;

    const idx = ids.indexOf(state.currentPlayerId);
    const dir = Number(state.currentDirection || 1);
    const nextIdx = ((idx + dir) % ids.length + ids.length) % ids.length;
    await stateRef.update({
      currentPlayerId: ids[nextIdx],
      lastAction: 'Turn timed out and auto-advanced',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
});
