import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCert,
  mockInitializeApp,
  mockGetApps,
  mockVerifyIdToken,
  mockGetAuth,
  mockSettings,
  mockGetFirestore,
} = vi.hoisted(() => {
  const verifyIdToken = vi.fn(async () => ({ uid: 'user_123', email: 'player@example.com' }));
  const settings = vi.fn();
  return {
    mockCert: vi.fn((cfg) => ({ __cert: cfg })),
    mockInitializeApp: vi.fn((opts) => ({ __app: opts })),
    mockGetApps: vi.fn(() => []),
    mockVerifyIdToken: verifyIdToken,
    mockGetAuth: vi.fn(() => ({ verifyIdToken })),
    mockSettings: settings,
    mockGetFirestore: vi.fn((_app, dbId?: string) => ({
      __dbId: dbId,
      settings,
    })),
  };
});

vi.mock('firebase-admin/app', () => ({
  cert: mockCert,
  getApps: mockGetApps,
  initializeApp: mockInitializeApp,
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: mockGetFirestore,
}));

import {
  ApiHttpError,
  FIRESTORE_DATABASE_ID,
  getFirebaseAdmin,
  getSafeAdminEnvStatus,
  hasAdminCredentialsConfigured,
  resetFirebaseAdminCache,
  sanitizeLogMessage,
  verifyFirebaseBearerToken,
} from '../firebaseAdmin';

describe('firebaseAdmin server initialization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetFirebaseAdminCache();
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    mockGetApps.mockReturnValue([]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetFirebaseAdminCache();
  });

  it('throws 503 listing missing env vars without hardcoded fallbacks', () => {
    expect(hasAdminCredentialsConfigured()).toBe(false);
    expect(() => getFirebaseAdmin()).toThrowError(ApiHttpError);
    expect(() => getFirebaseAdmin()).toThrow(
      /FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY/
    );
  });

  it('initializes Firebase Admin with escaped newline conversion and (default) Firestore DB', async () => {
    process.env.FIREBASE_PROJECT_ID = 'unoa-f18c9';
    process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@unoa-f18c9.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '"-----BEGIN PRIVATE KEY-----\\nLINE1\\nLINE2\\n-----END PRIVATE KEY-----\\n"';

    expect(hasAdminCredentialsConfigured()).toBe(true);
    expect(getSafeAdminEnvStatus()).toEqual({
      projectId: 'unoa-f18c9',
      databaseId: '(default)',
      hasProjectId: true,
      hasClientEmail: true,
      hasPrivateKey: true,
      privateKeyLooksValidPem: true,
    });

    const { adminDb } = getFirebaseAdmin();
    expect(FIRESTORE_DATABASE_ID).toBe('(default)');
    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'unoa-f18c9',
      clientEmail: 'firebase-adminsdk@unoa-f18c9.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nLINE1\nLINE2\n-----END PRIVATE KEY-----\n',
    });
    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: expect.any(Object),
      projectId: 'unoa-f18c9',
    });
    expect(mockGetFirestore).toHaveBeenCalledWith(expect.any(Object), '(default)');
    expect(mockSettings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
    expect((adminDb as unknown as { __dbId: string }).__dbId).toBe('(default)');

    // Second call returns cached singleton without re-initializing
    getFirebaseAdmin();
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);

    const verified = await verifyFirebaseBearerToken('Bearer test_token_123');
    expect(verified.uid).toBe('user_123');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('test_token_123');
  });

  it('redacts private keys, bearer tokens, and JWTs from logs and wraps init errors as ApiHttpError(500)', () => {
    const redacted = sanitizeLogMessage(
      'Failed with -----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY----- Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiIxMjMifQ.sig123'
    );
    expect(redacted).not.toContain('SECRET');
    expect(redacted).not.toContain('abc.def.ghi');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');

    process.env.FIREBASE_PROJECT_ID = 'unoa-f18c9';
    process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@unoa-f18c9.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = 'bad-key';
    mockCert.mockImplementationOnce(() => {
      throw new Error('Invalid PEM formatted private key');
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => getFirebaseAdmin()).toThrowError(ApiHttpError);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
