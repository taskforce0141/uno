import type { IncomingMessage } from 'node:http';
import {
  ApiHttpError,
  getSafeAdminEnvStatus,
  sanitizeLogMessage,
  verifyFirebaseBearerToken,
} from '../../src/server/firebaseAdmin.ts';

export interface ServerlessRequest extends IncomingMessage {
  method?: string;
  body?: unknown;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ServerlessResponse {
  status?: (code: number) => ServerlessResponse;
  json?: (payload: unknown) => void;
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

function sendJsonResponse(res: ServerlessResponse, statusCode: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const nextRes = res.status(statusCode);
    if (nextRes && typeof nextRes.json === 'function') {
      nextRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function parseRequestBody(req: ServerlessRequest): Promise<Record<string, unknown>> {
  let preParsedBody: unknown;
  try {
    preParsedBody = req.body;
  } catch {
    throw new ApiHttpError(400, 'Invalid JSON request body.');
  }

  if (preParsedBody && typeof preParsedBody === 'object' && !Buffer.isBuffer(preParsedBody)) {
    return preParsedBody as Record<string, unknown>;
  }
  if (typeof preParsedBody === 'string' && preParsedBody.trim()) {
    try {
      return JSON.parse(preParsedBody) as Record<string, unknown>;
    } catch {
      throw new ApiHttpError(400, 'Invalid JSON request body.');
    }
  }
  if (Buffer.isBuffer(preParsedBody) && preParsedBody.length > 0) {
    try {
      return JSON.parse(preParsedBody.toString('utf-8')) as Record<string, unknown>;
    } catch {
      throw new ApiHttpError(400, 'Invalid JSON request body.');
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiHttpError(400, 'Invalid JSON request body.');
  }
}

export async function handleAuthenticatedPost(
  req: ServerlessRequest,
  res: ServerlessResponse,
  handler: (uid: string, body: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      res.status(204).end();
    } else {
      res.statusCode = 204;
      res.end();
    }
    return;
  }

  if (req.method !== 'POST') {
    sendJsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const authHeader = req.headers.authorization ?? req.headers.Authorization;
    const { uid } = await verifyFirebaseBearerToken(authHeader);
    const body = await parseRequestBody(req);
    const result = await handler(uid, body);
    sendJsonResponse(res, 200, { success: true, ...(result as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof ApiHttpError) {
      if (err.statusCode >= 500) {
        console.error('[UNO ARENA API 5xx]', {
          url: req.url || 'unknown',
          statusCode: err.statusCode,
          message: sanitizeLogMessage(err),
          env: getSafeAdminEnvStatus(),
        });
      }
      sendJsonResponse(res, err.statusCode, { error: sanitizeLogMessage(err) });
      return;
    }

    const safeMessage = sanitizeLogMessage(err);
    console.error('[UNO ARENA API Unhandled 500]', {
      url: req.url || 'unknown',
      errorName: err instanceof Error ? err.name : 'Error',
      errorCode: (err as { code?: string | number })?.code ?? null,
      message: safeMessage,
      env: getSafeAdminEnvStatus(),
    });
    sendJsonResponse(res, 500, {
      error: safeMessage || 'Unexpected server error processing game action.',
    });
  }
}
