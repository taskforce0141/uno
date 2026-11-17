import { CardColor, PublicGameState, RoomData, UnoCard } from '../engine/gameTypes';
import { auth } from './firebase';
import { API_BASE_URL, buildApiUrl } from './sessionService';

export type SocketMessage =
  | { type: 'state_sync'; room: RoomData; gameState: PublicGameState | null; hand: UnoCard[] }
  | { type: 'error'; message: string }
  | { type: 'kicked'; message: string }
  | { type: 'room_closed'; message: string };

export interface FirebaseGameApiResponse {
  success?: boolean;
  room: RoomData;
  gameState: PublicGameState | null;
  hand: UnoCard[];
}

export async function firebaseGameApiRequest<T = FirebaseGameApiResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required. Please sign in and try again.');
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    throw new Error('Unable to verify your Firebase session. Please refresh and sign in again.');
  }

  const targetUrl = buildApiUrl(path);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error contacting the UNO ARENA game server. Please try again.');
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  let data: Record<string, unknown> | null = null;

  if (text && (contentType.includes('application/json') || text.trim().startsWith('{'))) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON response from game server (${res.status}).`);
    }
  } else if (!res.ok || contentType.includes('text/html')) {
    throw new Error(
      `Game API endpoint ${path} returned an unexpected response (${res.status}). Verify deployment and Firebase Admin configuration.`
    );
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data.error === 'string' && data.error) ||
      `Game server request failed (${res.status}).`;
    throw new Error(errMsg);
  }

  if (!data) {
    throw new Error(`Empty response from game server (${res.status}).`);
  }

  return data as unknown as T;
}

function getEndpointForGameAction(actionType: string): string {
  switch (actionType) {
    case 'play_cards':
      return '/api/game/play-card';
    case 'draw_card':
      return '/api/game/draw-card';
    case 'call_uno':
    case 'catch_uno':
      return '/api/game/call-uno';
    case 'challenge_wild4':
      return '/api/game/challenge';
    case 'leave':
      return '/api/game/leave';
    default:
      return '/api/game/action';
  }
}

export async function submitFirebaseGameAction(
  roomId: string,
  actionType: string,
  payload: Record<string, unknown> = {}
): Promise<FirebaseGameApiResponse> {
  const endpoint = getEndpointForGameAction(actionType);
  const actionId =
    typeof payload.actionId === 'string' && payload.actionId
      ? payload.actionId
      : `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return firebaseGameApiRequest<FirebaseGameApiResponse>(endpoint, {
    roomId,
    actionType,
    actionId,
    ...payload,
  });
}

export function createGameWebSocket(
  roomId: string,
  sessionToken: string,
  onMessage: (msg: SocketMessage) => void,
  onStatusChange: (status: 'connecting' | 'connected' | 'reconnecting') => void
): {
  sendAction: (actionType: string, payload?: Record<string, unknown>) => void;
  close: () => void;
} {
  let ws: WebSocket | null = null;
  let closedManually = false;
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;

  function connect() {
    if (closedManually) return;
    onStatusChange(ws ? 'reconnecting' : 'connecting');

    let wsBase: string;
    if (API_BASE_URL) {
      wsBase = API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsBase = `${protocol}//${window.location.host}`;
    }
    const url = `${wsBase}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(sessionToken)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      onStatusChange('connected');
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as SocketMessage;
        onMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (!closedManually) {
        onStatusChange('reconnecting');
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };
  }

  connect();

  return {
    sendAction(actionType: string, payload: Record<string, unknown> = {}) {
      const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'action',
            actionType,
            actionId,
            ...payload,
          })
        );
      } else {
        // REST fallback when socket is mid-reconnect
        fetch(buildApiUrl(`/api/rooms/${encodeURIComponent(roomId)}/action`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ actionType, actionId, ...payload }),
        }).catch(() => {});
      }
    },
    close() {
      closedManually = true;
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

export async function submitRestAction(
  sessionToken: string,
  roomId: string,
  actionType: string,
  payload: Record<string, unknown> = {}
) {
  const res = await fetch(buildApiUrl(`/api/rooms/${encodeURIComponent(roomId)}/action`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      actionType,
      actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...payload,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Action failed');
  }
  return data as { gameState: PublicGameState | null; hand: UnoCard[]; chosenColor?: CardColor };
}
