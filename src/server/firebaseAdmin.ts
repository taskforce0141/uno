import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export class ApiHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
  }
}

export const FIRESTORE_DATABASE_ID = '(default)';

export function sanitizeLogMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? 'Unknown error');
  return raw
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED_JWT]');
}

function readAdminEnvCredentials(): {
  projectId: string | undefined;
  clientEmail: string | undefined;
  privateKey: string | undefined;
} {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || undefined;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() || undefined;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawPrivateKey
    ? rawPrivateKey.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
    : undefined;

  return {
    projectId,
    clientEmail,
    privateKey: privateKey || undefined,
  };
}

export function getSafeAdminEnvStatus() {
  const { projectId, clientEmail, privateKey } = readAdminEnvCredentials();
  return {
    projectId: projectId ?? null,
    databaseId: FIRESTORE_DATABASE_ID,
    hasProjectId: Boolean(projectId),
    hasClientEmail: Boolean(clientEmail),
    hasPrivateKey: Boolean(privateKey),
    privateKeyLooksValidPem: Boolean(
      privateKey &&
        privateKey.includes('BEGIN PRIVATE KEY') &&
        privateKey.includes('END PRIVATE KEY') &&
        privateKey.includes('\n')
    ),
  };
}

export function hasAdminCredentialsConfigured(): boolean {
  const { projectId, clientEmail, privateKey } = readAdminEnvCredentials();
  return Boolean(projectId && clientEmail && privateKey);
}

let cachedApp: App | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function resetFirebaseAdminCache(): void {
  cachedApp = null;
  cachedAuth = null;
  cachedDb = null;
}

export function getFirebaseAdmin(): { app: App; adminAuth: Auth; adminDb: Firestore } {
  if (cachedApp && cachedAuth && cachedDb) {
    return { app: cachedApp, adminAuth: cachedAuth, adminDb: cachedDb };
  }

  const { projectId, clientEmail, privateKey } = readAdminEnvCredentials();
  const missing: string[] = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY');

  if (missing.length > 0 || !projectId || !clientEmail || !privateKey) {
    console.error('[UNO ARENA Firebase Admin] Missing configuration:', getSafeAdminEnvStatus());
    throw new ApiHttpError(
      503,
      `Server-side Firebase Admin credentials are not configured. Missing environment variable(s): ${missing.join(', ')}.`
    );
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      cachedApp = existingApps[0];
    } else {
      cachedApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
    }

    cachedAuth = getAuth(cachedApp);
    cachedDb = getFirestore(cachedApp, FIRESTORE_DATABASE_ID);
    try {
      cachedDb.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Ignore if settings were already applied on a warm instance
    }
  } catch (err) {
    console.error('[UNO ARENA Firebase Admin] Initialization error:', {
      ...getSafeAdminEnvStatus(),
      errorName: err instanceof Error ? err.name : 'Error',
      errorCode: (err as { code?: string })?.code ?? null,
      errorMessage: sanitizeLogMessage(err),
    });
    cachedApp = null;
    cachedAuth = null;
    cachedDb = null;
    throw new ApiHttpError(
      500,
      `Firebase Admin initialization failed: ${sanitizeLogMessage(err)}`
    );
  }

  return { app: cachedApp, adminAuth: cachedAuth, adminDb: cachedDb };
}

export async function verifyFirebaseBearerToken(
  authorizationHeader: string | string[] | undefined
): Promise<{ uid: string; email: string | null }> {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiHttpError(401, 'Missing Authorization Bearer Firebase ID token.');
  }

  const token = header.slice(7).trim();
  if (!token) {
    throw new ApiHttpError(401, 'Empty Firebase ID token.');
  }

  const { adminAuth } = getFirebaseAdmin();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
    };
  } catch (err) {
    const safeMsg = sanitizeLogMessage(err);
    console.error('[UNO ARENA Auth] Firebase ID token verification failed:', {
      projectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
      errorCode: (err as { code?: string })?.code ?? null,
      errorMessage: safeMsg,
    });
    throw new ApiHttpError(401, `Firebase authentication verification failed: ${safeMsg}`);
  }
}
