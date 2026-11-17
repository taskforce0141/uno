import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

export class ApiHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export const FIRESTORE_DATABASE_ID = '(default)';

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
    throw new ApiHttpError(
      503,
      `Server-side Firebase Admin credentials are not configured. Missing environment variable(s): ${missing.join(', ')}.`
    );
  }

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
    const message = err instanceof Error ? err.message : 'Invalid token';
    throw new ApiHttpError(401, `Firebase authentication verification failed: ${message}`);
  }
}
