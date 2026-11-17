# UNO ARENA Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Private Rooms Only**: No user can list all rooms (`allow list` is restricted to `resource.data.hostId == request.auth.uid`), and `roomCodes` forbids `list` completely (`allow list: if false`) so codes cannot be enumerated.
2. **PII Isolation**: User emails and provider details live exclusively in `/users/{userId}/private/info`, readable and writable only by `request.auth.uid == userId`.
3. **Private Player Hands**: `/rooms/{roomId}/game/hands/{playerId}` is readable ONLY when `request.auth.uid == playerId` AND the user is a verified member of `/rooms/{roomId}/players/{playerId}`. Client writes to hands are strictly forbidden (`allow write: if false`) — only the trusted server / Cloud Functions (Admin SDK) can mutate hands and the secret deck.
4. **Secret Deck Protection**: `/rooms/{roomId}/game/secret/{docId}` has `allow read, write: if false` so no client can ever inspect the draw pile order or upcoming cards.
5. **Host Authority**: Only the current `hostId` on `/rooms/{roomId}` can modify `gameMode`, `maxPlayers`, `roomName`, or `customRules`, and only while `status == 'lobby'`.
6. **Terminal State Locking**: Once a room reaches `status == 'closed'`, no further updates are permitted.
7. **Temporal & Identity Integrity**: All `createdAt` / `updatedAt` timestamps must equal `request.time`; `uid`, `hostId`, and `playerId` must match `request.auth.uid` on creation and remain immutable on update.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing (User Profile)**: User A attempts to create `/users/userB` with `uid: "userB"` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection (User Profile)**: User A updates `/users/userA` adding `isAdmin: true` -> `PERMISSION_DENIED`.
3. **PII Snooping**: User A attempts `get` on `/users/userB/private/info` -> `PERMISSION_DENIED`.
4. **Room Enumeration**: User A runs `list` on `/roomCodes` or `/rooms` without matching `hostId` -> `PERMISSION_DENIED`.
5. **Non-Private Room Creation**: User A creates `/rooms/r1` with `privacy: "public"` -> `PERMISSION_DENIED`.
6. **Resource Poisoning (Oversized ID / Name)**: User A creates `/rooms/r1` with `roomName` of 500 characters or invalid path ID -> `PERMISSION_DENIED`.
7. **Host Hijack**: Non-host Player B attempts to update `/rooms/r1` changing `hostId` or `customRules` -> `PERMISSION_DENIED`.
8. **Closed Room Resurrection**: Host attempts to update `/rooms/r1` after `status == "closed"` -> `PERMISSION_DENIED`.
9. **Other Player Hand Snooping**: Player A attempts `get` on `/rooms/r1/game/hands/playerB` -> `PERMISSION_DENIED`.
10. **Hand Tampering**: Player A attempts to write/update `/rooms/r1/game/hands/playerA` to give themselves Wild+4 cards -> `PERMISSION_DENIED`.
11. **Secret Deck Snooping**: Player A attempts `get` on `/rooms/r1/game/secret/deck` -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: User A creates `/rooms/r1/players/userA` with a backdated `joinedAt` timestamp instead of `request.time` -> `PERMISSION_DENIED`.
