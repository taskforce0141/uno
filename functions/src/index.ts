import * as admin from 'firebase-admin';
import { createPrivateRoom, joinPrivateRoom, leavePrivateRoom } from './rooms';
import { startGame, submitGameAction } from './gameActions';
import { enforceTurnTimers } from './turnManagement';
import { cleanupStaleRooms } from './cleanup';

admin.initializeApp();

export {
  createPrivateRoom,
  joinPrivateRoom,
  leavePrivateRoom,
  startGame,
  submitGameAction,
  enforceTurnTimers,
  cleanupStaleRooms,
};
