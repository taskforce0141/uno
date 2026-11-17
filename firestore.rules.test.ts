import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UNO ARENA Firestore Security Rules Static & Policy Audit', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const draftPath = path.resolve(process.cwd(), 'DRAFT_firestore.rules');
  const activePath = fs.existsSync(rulesPath) ? rulesPath : draftPath;
  const rules = fs.readFileSync(activePath, 'utf-8');

  it('enforces rules_version 2 and global default-deny catch-all', () => {
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
  });

  it('prevents room code enumeration via allow list: if false on /roomCodes', () => {
    expect(rules).toMatch(/match \/roomCodes\/\{roomCode\}[\s\S]*allow list: if false;/);
  });

  it('isolates PII to owner-only /users/{userId}/private/{docId}', () => {
    expect(rules).toMatch(/match \/private\/\{docId\}[\s\S]*allow get: if isValidId\(userId\) && isValidId\(docId\) && isOwner\(userId\);/);
  });

  it('locks private player hands so only owner can read and no client can write', () => {
    expect(rules).toMatch(/match \/game\/hands\/\{playerId\}[\s\S]*allow get: if isValidId\(roomId\) && isValidId\(playerId\) && isOwner\(playerId\) && isRoomMember\(roomId\);[\s\S]*allow write: if false;/);
  });

  it('completely blocks client access to secret deck state', () => {
    expect(rules).toMatch(/match \/game\/secret\/\{docId\}[\s\S]*allow read, write: if false;/);
  });

  it('enforces terminal state locking on closed rooms', () => {
    expect(rules).toContain("existing().status != 'closed'");
  });

  it('enforces server timestamp validation and immutable fields', () => {
    expect(rules).toContain('request.time');
    expect(rules).toContain("data.privacy == 'private'");
  });

  it('allows owner-only pre-join player doc check while locking room and player list to members', () => {
    expect(rules).toMatch(
      /match \/rooms\/\{roomId\}[\s\S]*allow get: if isValidId\(roomId\) && isSignedIn\(\) && \(existing\(\)\.hostId == request\.auth\.uid \|\| isRoomMember\(roomId\)\);/
    );
    expect(rules).toMatch(
      /match \/players\/\{playerId\}[\s\S]*allow get: if isValidId\(roomId\) && isValidId\(playerId\) && \(isOwner\(playerId\) \|\| isRoomMember\(roomId\) \|\| isRoomHost\(roomId\)\);/
    );
    expect(rules).toMatch(
      /match \/players\/\{playerId\}[\s\S]*allow list: if isRoomMember\(roomId\) \|\| isRoomHost\(roomId\);/
    );
  });

  it('enforces waiting status, room capacity, non-spoofable isHost, and atomic playerCount increment on join', () => {
    expect(rules).toContain('data.playerCount <= data.maxPlayers');
    expect(rules).toContain("get(/databases/$(database)/documents/rooms/$(roomId)).data.playerCount < get(/databases/$(database)/documents/rooms/$(roomId)).data.maxPlayers");
    expect(rules).toContain('incoming().isHost == (get(/databases/$(database)/documents/rooms/$(roomId)).data.hostId == playerId)');
    expect(rules).toContain('incoming().playerCount == existing().playerCount + 1');
    expect(rules).toContain('incoming().playerCount <= existing().maxPlayers');
  });
});
