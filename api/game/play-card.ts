import {
  handleAuthenticatedPost,
  ServerlessRequest,
  ServerlessResponse,
} from '../_lib/gameEndpointHandler.ts';
import { executeMatchActionInFirestore } from '../../src/server/firestoreGameService.ts';

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await handleAuthenticatedPost(req, res, async (uid, body) => {
    const roomId = String(body.roomId || '');
    return executeMatchActionInFirestore(uid, roomId, 'play_cards', body);
  });
}
