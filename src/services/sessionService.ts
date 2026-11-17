import { auth } from './firebase';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const USE_CLOUD_FUNCTIONS = import.meta.env.VITE_USE_CLOUD_FUNCTIONS === 'true';

export function buildApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export interface DiagnosticDetails {
  errorMessage: string;
  firebaseCode?: string;
  httpStatus?: number | null;
  endpoint?: string;
  responseBody?: string;
  authState?: {
    hasCurrentUser: boolean;
    uid: string | null;
    isAnonymous: boolean | null;
  };
}

export function getSanitizedAuthState() {
  const current = auth.currentUser;
  return {
    hasCurrentUser: Boolean(current),
    uid: current?.uid ?? null,
    isAnonymous: current?.isAnonymous ?? null,
  };
}

function sanitizeResponsePreview(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/"sessionToken"\s*:\s*"[^"]*"/gi, '"sessionToken":"[redacted]"')
    .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[redacted]"')
    .slice(0, 300);
}

export function logAuthDiagnostics(context: string, details: DiagnosticDetails): void {
  const payload: DiagnosticDetails = {
    ...details,
    authState: details.authState || getSanitizedAuthState(),
    responseBody: details.responseBody
      ? sanitizeResponsePreview(details.responseBody)
      : undefined,
  };

  if (import.meta.env.DEV) {
    console.warn(`[UNO ARENA Auth Diagnostic] ${context}:`, payload);
  }
}

export interface OptionalSessionResult {
  available: boolean;
  sessionToken: string;
  httpStatus?: number;
}

/**
 * Attempts to obtain an optional HMAC-signed Express/WebSocket session token
 * when a Node backend (/api/auth/session or VITE_API_BASE_URL) is running.
 * On static deployments (e.g. Vercel without an Express server), 404/405/non-JSON
 * responses are handled gracefully so Firebase Auth & Firestore continue working.
 */
export async function exchangeServerSessionOptional(
  uid: string
): Promise<OptionalSessionResult> {
  const endpoint = buildApiUrl('/api/auth/session');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, guestFallback: false }),
    });

    const contentType = res.headers.get('content-type') || '';
    const rawBody = await res.text();

    if (!res.ok || !contentType.includes('application/json')) {
      logAuthDiagnostics('Optional backend session endpoint unavailable', {
        errorMessage: `Backend session endpoint returned HTTP ${res.status}`,
        httpStatus: res.status,
        endpoint,
        responseBody: rawBody,
      });
      return { available: false, sessionToken: '', httpStatus: res.status };
    }

    const parsed = JSON.parse(rawBody) as { sessionToken?: unknown };
    if (typeof parsed.sessionToken !== 'string' || !parsed.sessionToken) {
      logAuthDiagnostics('Optional backend session response missing sessionToken', {
        errorMessage: 'Response JSON did not contain a valid sessionToken.',
        httpStatus: res.status,
        endpoint,
        responseBody: rawBody,
      });
      return { available: false, sessionToken: '', httpStatus: res.status };
    }

    return { available: true, sessionToken: parsed.sessionToken, httpStatus: res.status };
  } catch (err) {
    logAuthDiagnostics('Optional backend session request failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
      httpStatus: null,
      endpoint,
    });
    return { available: false, sessionToken: '' };
  }
}

/**
 * Only used when Firebase Anonymous Authentication is explicitly disabled in Console
 * and a live Express backend server is available to issue a signed guest session.
 */
export async function requestServerGuestFallbackSession(
  existingGuestUid: string | undefined,
  firebaseCode: string,
  firebaseErrorMessage: string
): Promise<{ uid: string; sessionToken: string }> {
  const endpoint = buildApiUrl('/api/auth/session');

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: existingGuestUid, guestFallback: true }),
    });
  } catch (networkErr) {
    const netMsg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    logAuthDiagnostics('Guest fallback session network failure', {
      errorMessage: netMsg,
      firebaseCode,
      httpStatus: null,
      endpoint,
    });
    throw new Error(
      `Firebase Anonymous Authentication failed (${firebaseCode}: ${firebaseErrorMessage}) and backend session endpoint ${endpoint} is unreachable (${netMsg}).`
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const rawBody = await res.text();

  if (!res.ok || !contentType.includes('application/json')) {
    logAuthDiagnostics('Guest fallback session endpoint error', {
      errorMessage: `HTTP ${res.status} from ${endpoint}`,
      firebaseCode,
      httpStatus: res.status,
      endpoint,
      responseBody: rawBody,
    });
    throw new Error(
      `Firebase Anonymous Authentication is disabled (${firebaseCode}) and ${endpoint} returned HTTP ${res.status}. Enable Anonymous sign-in in Firebase Console → Authentication → Sign-in method.`
    );
  }

  const data = JSON.parse(rawBody) as { uid?: string; sessionToken?: string; error?: string };
  if (!data.uid || !data.sessionToken) {
    logAuthDiagnostics('Guest fallback response incomplete', {
      errorMessage: data.error || 'Missing uid or sessionToken in response',
      firebaseCode,
      httpStatus: res.status,
      endpoint,
      responseBody: rawBody,
    });
    throw new Error(
      data.error ||
        `Backend session endpoint ${endpoint} returned an incomplete response (HTTP ${res.status}).`
    );
  }

  return { uid: data.uid, sessionToken: data.sessionToken };
}

export function formatFirebaseAuthError(err: unknown, actionLabel: string): Error {
  const code = (err as { code?: string })?.code || '';
  const rawMessage = err instanceof Error ? err.message : String(err);

  logAuthDiagnostics(`${actionLabel} failed`, {
    errorMessage: rawMessage,
    firebaseCode: code || undefined,
  });

  switch (code) {
    case 'auth/unauthorized-domain':
      return new Error(
        `This domain (${typeof window !== 'undefined' ? window.location.hostname : 'unknown'}) is not authorized in Firebase Authentication (${code}). Add it in Firebase Console → Authentication → Settings → Authorized domains.`
      );
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return new Error(
        `This sign-in provider is not enabled in Firebase Authentication (${code}). Enable it in Firebase Console → Authentication → Sign-in method.`
      );
    case 'auth/network-request-failed':
      return new Error(
        `Network error communicating with Firebase Authentication (${code}). Please check your connection and try again.`
      );
    case 'auth/invalid-api-key':
      return new Error(
        `Invalid Firebase API key configuration (${code}). Verify your Firebase project settings.`
      );
    case 'auth/popup-blocked':
      return new Error(
        `Sign-in popup was blocked by your browser (${code}). Allow popups for this site and try again.`
      );
    case 'auth/popup-closed-by-user':
      return new Error(`Sign-in popup was closed before completing (${code}).`);
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return new Error(`Invalid email or password (${code}).`);
    case 'auth/email-already-in-use':
      return new Error(`An account with this email already exists (${code}).`);
    case 'auth/weak-password':
      return new Error(`Password must be at least 6 characters (${code}).`);
    default:
      if (code) {
        return new Error(`${actionLabel} failed (${code}): ${rawMessage}`);
      }
      return err instanceof Error ? err : new Error(`${actionLabel} failed: ${rawMessage}`);
  }
}
