import { CardColor, PublicGameState, RoomData, UnoCard } from '../engine/gameTypes';
import { API_BASE_URL, buildApiUrl } from './sessionService';

export type SocketMessage =
  | { type: 'state_sync'; room: RoomData; gameState: PublicGameState | null; hand: UnoCard[] }
  | { type: 'error'; message: string }
  | { type: 'kicked'; message: string }
  | { type: 'room_closed'; message: string };

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
