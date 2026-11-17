import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

export const cleanupStaleRooms = onSchedule('every 60 minutes', async () => {
  const db = admin.firestore();
  const staleCutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 60 * 60 * 1000);

  const staleSnap = await db
    .collection('rooms')
    .where('updatedAt', '<', staleCutoff)
    .limit(50)
    .get();

  const batch = db.batch();
  for (const roomDoc of staleSnap.docs) {
    const data = roomDoc.data();
    batch.update(roomDoc.ref, { status: 'closed' });
    if (data.roomCode) {
      batch.delete(db.collection('roomCodes').doc(data.roomCode));
    }
  }
  await batch.commit();
});
