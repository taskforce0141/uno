import { IncomingMessage } from 'node:http';
import { ApiHttpError, verifyFirebaseBearerToken } from '../../src/server/firebaseAdmin.ts';

export interface ServerlessRequest extends IncomingMessage {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface ServerlessResponse {
  status: (code: number) => ServerlessResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

async function parseRequestBody(req: ServerlessRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      throw new ApiHttpError(400, 'Invalid JSON request body.');
    }
  }
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    try {
      return JSON.parse(req.body.toString('utf-8')) as Record<string, unknown>;
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
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { uid } = await verifyFirebaseBearerToken(req.headers.authorization);
    const body = await parseRequestBody(req);
    const result = await handler(uid, body);
    res.status(200).json({ success: true, ...(result as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof ApiHttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[UNO ARENA API Error]', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected server error processing game action.',
    });
  }
}
