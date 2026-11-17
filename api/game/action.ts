import { handleAuthenticatedPost } from '../_lib/gameEndpointHandler.ts';
import type { ServerlessRequest, ServerlessResponse } from '../_lib/gameEndpointHandler.ts';
import { ApiHttpError } from '../../src/server/firebaseAdmin.ts';
import { executeMatchActionInFirestore } from '../../src/server/firestoreGameService.ts';
import type { ServerGameActionType } from '../../src/server/firestoreGameService.ts';

const ALLOWED_ACTIONS = new Set<ServerGameActionType>([
  'play_cards',
  'draw_card',
  'choose_color',
  'swap_hands',
  'challenge_wild4',
  'call_uno',
  'catch_uno',
  'pass_turn',
  'timeout',
  'next_round',
  'restart',
  'return_lobby',
  'leave',
]);

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  await handleAuthenticatedPost(req, res, async (uid, body) => {
    const roomId = String(body.roomId || '');
    const actionType = String(body.actionType || '') as ServerGameActionType;
    if (!ALLOWED_ACTIONS.has(actionType)) {
      throw new ApiHttpError(400, `Unsupported actionType: ${actionType}`);
    }
    return executeMatchActionInFirestore(uid, roomId, actionType, body);
  });
}
