import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUsersStore = new Map<string, Record<string, unknown>>();
let mockFirebaseUser: {
  uid: string;
  displayName: string | null;
  isAnonymous: boolean;
  email: string | null;
  providerData: Array<{ providerId: string }>;
} | null = null;
let mockSignInAnonymouslyError: (Error & { code?: string }) | null = null;

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(async () => {
    if (mockSignInAnonymouslyError) {
      throw mockSignInAnonymouslyError;
    }
    mockFirebaseUser = {
      uid: 'anon_vercel_uid_999',
      displayName: null,
      isAnonymous: true,
      email: null,
      providerData: [],
    };
    return { user: mockFirebaseUser };
  }),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(async (user: { displayName: string | null }, data: { displayName?: string }) => {
    if (data.displayName) user.displayName = data.displayName;
  }),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    id: segments[segments.length - 1],
  }),
  serverTimestamp: () => ({ __ts: true }),
  runTransaction: async (
    _db: unknown,
    fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<void>
  ) => {
    const tx = {
      get: async (ref: { path: string }) => ({
        exists: () => mockUsersStore.has(ref.path),
        data: () => mockUsersStore.get(ref.path),
      }),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        mockUsersStore.set(ref.path, data);
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        mockUsersStore.set(ref.path, { ...(mockUsersStore.get(ref.path) || {}), ...data });
      },
    };
    await fn(tx);
  },
}));

vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return mockFirebaseUser;
    },
  },
  db: {},
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
  handleFirestoreError: (err: unknown) => {
    throw err;
  },
}));

import { loginAsGuest } from '../authService';

describe('authService & sessionService Vercel compatibility', () => {
  beforeEach(() => {
    mockUsersStore.clear();
    mockFirebaseUser = null;
    mockSignInAnonymouslyError = null;
  });

  it('completes Guest login via Firebase Anonymous Auth even when /api/auth/session returns 404 (Vercel)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;

    const appUser = await loginAsGuest('VercelGuest', 'crimson');

    expect(appUser.uid).toBe('anon_vercel_uid_999');
    expect(appUser.username).toBe('VercelGuest');
    expect(appUser.isAnonymous).toBe(true);
    expect(appUser.authSource).toBe('firebase');
    expect(appUser.sessionToken).toBe('');

    const profile = mockUsersStore.get('users/anon_vercel_uid_999');
    expect(profile).toBeTruthy();
    expect(profile?.username).toBe('VercelGuest');
    expect(profile?.isAnonymous).toBe(true);
  });

  it('populates sessionToken when Express backend /api/auth/session is live', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uid: 'anon_vercel_uid_999', sessionToken: 'signed.tok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const appUser = await loginAsGuest('LocalHost', 'cobalt');
    expect(appUser.uid).toBe('anon_vercel_uid_999');
    expect(appUser.sessionToken).toBe('signed.tok');
    expect(appUser.authSource).toBe('firebase');
  });

  it('surfaces meaningful Firebase error code when domain is unauthorized', async () => {
    const err = Object.assign(new Error('This domain is not authorized'), {
      code: 'auth/unauthorized-domain',
    });
    mockSignInAnonymouslyError = err;

    await expect(loginAsGuest('GuestUser', 'crimson')).rejects.toThrow(
      /auth\/unauthorized-domain/
    );
  });

  it('surfaces diagnostic error including HTTP status when Anonymous Auth is disabled and /api/auth/session returns 404', async () => {
    const err = Object.assign(new Error('Admin restricted'), {
      code: 'auth/operation-not-allowed',
    });
    mockSignInAnonymouslyError = err;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    ) as unknown as typeof fetch;

    await expect(loginAsGuest('GuestUser', 'crimson')).rejects.toThrow(
      /auth\/operation-not-allowed.*HTTP 404/i
    );
  });
});
