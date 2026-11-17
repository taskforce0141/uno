export function buildInviteUrl(roomCode: string): string {
  if (typeof window === 'undefined') {
    return `/room/${roomCode}`;
  }
  return `${window.location.origin}/room/${roomCode.toUpperCase()}`;
}

export function sanitizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function extractRoomCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  return match ? match[1].toUpperCase() : null;
}

export function extractLobbyRoomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/lobby\/([A-Za-z0-9_-]{3,128})\/?$/);
  return match ? match[1] : null;
}

