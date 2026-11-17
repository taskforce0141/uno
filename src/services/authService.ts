import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { AVATAR_OPTIONS } from '../engine/gameTypes';

export interface AppUser {
  uid: string;
  username: string;
  avatar: string;
  isAnonymous: boolean;
  email?: string | null;
  gamesPlayed: number;
  wins: number;
  sessionToken: string;
  authSource: 'firebase' | 'guest_session';
}

const LOCAL_GUEST_KEY = 'uno_arena_guest_session_v1';
const LOCAL_PROFILE_KEY = 'uno_arena_profile_prefs_v1';
const syncQueueByUid = new Map<string, Promise<unknown>>();

interface StoredProfilePrefs {
  username: string;
  avatar: string;
}

function getStoredPrefs(): StoredProfilePrefs {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredProfilePrefs>;
      return {
        username: parsed.username || 'Player',
        avatar: parsed.avatar || AVATAR_OPTIONS[0].id,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { username: 'Player', avatar: AVATAR_OPTIONS[0].id };
}

export function saveStoredPrefs(prefs: Partial<StoredProfilePrefs>) {
  const current = getStoredPrefs();
  const next = { ...current, ...prefs };
  try {
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

async function exchangeServerSession(
  uid?: string,
  guestFallback = false
): Promise<{ uid: string; sessionToken: string }> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, guestFallback }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to establish multiplayer session.');
  }
  return res.json();
}

function normalizeSafeName(username: string): string {
  let clean = username.trim().slice(0, 24);
  if (clean.length < 2) {
    clean = clean.length === 1 ? `${clean}_` : 'Player';
  }
  return clean;
}

async function syncUserToFirestore(
  user: User,
  username: string,
  avatar: string
): Promise<{ gamesPlayed: number; wins: number }> {
  const previous = syncQueueByUid.get(user.uid) || Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const safeName = normalizeSafeName(username);
      const safeAvatar = (avatar || 'crimson').trim().slice(0, 128) || 'crimson';
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, 'users', user.uid);

      let gamesPlayed = 0;
      let wins = 0;

      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(userRef);
          if (!snap.exists()) {
            tx.set(userRef, {
              uid: user.uid,
              username: safeName,
              avatar: safeAvatar,
              isAnonymous: user.isAnonymous,
              gamesPlayed: 0,
              wins: 0,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            const existing = snap.data();
            gamesPlayed = Number(existing.gamesPlayed || 0);
            wins = Number(existing.wins || 0);
            tx.update(userRef, {
              username: safeName,
              avatar: safeAvatar,
              updatedAt: serverTimestamp(),
            });
          }
        });

        if (!user.isAnonymous) {
          const privateRef = doc(db, 'users', user.uid, 'private', 'info');
          const providerId = user.providerData[0]?.providerId || 'password';
          await runTransaction(db, async (tx) => {
            const pSnap = await tx.get(privateRef);
            if (!pSnap.exists()) {
              tx.set(privateRef, {
                uid: user.uid,
                ...(user.email ? { email: user.email } : {}),
                providerId,
                updatedAt: serverTimestamp(),
              });
            } else {
              tx.update(privateRef, {
                ...(user.email ? { email: user.email } : {}),
                providerId,
                updatedAt: serverTimestamp(),
              });
            }
          });
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.WRITE, userPath);
        }
      }

      return { gamesPlayed, wins };
    });

  syncQueueByUid.set(user.uid, run);
  return run;
}

export async function buildAppUserFromFirebase(
  firebaseUser: User,
  overrideUsername?: string,
  overrideAvatar?: string
): Promise<AppUser> {
  const prefs = getStoredPrefs();
  const username =
    (overrideUsername || firebaseUser.displayName || prefs.username || 'Player')
      .trim()
      .slice(0, 24) || 'Player';
  const avatar = overrideAvatar || prefs.avatar || 'crimson';
  saveStoredPrefs({ username, avatar });

  const stats = await syncUserToFirestore(firebaseUser, username, avatar);
  const { sessionToken } = await exchangeServerSession(firebaseUser.uid, false);

  return {
    uid: firebaseUser.uid,
    username,
    avatar,
    isAnonymous: firebaseUser.isAnonymous,
    email: firebaseUser.email,
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    sessionToken,
    authSource: 'firebase',
  };
}

export async function loginAsGuest(usernameInput: string, avatarId: string): Promise<AppUser> {
  const cleanName = usernameInput.trim().slice(0, 24);
  if (cleanName.length < 2) {
    throw new Error('Please enter a username with at least 2 characters.');
  }
  saveStoredPrefs({ username: cleanName, avatar: avatarId });

  try {
    const cred = await signInAnonymously(auth);
    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
    return await buildAppUserFromFirebase(cred.user, cleanName, avatarId);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    // Graceful server-signed guest session when Firebase Anonymous provider is not yet enabled in Console
    if (
      code === 'auth/operation-not-allowed' ||
      code === 'auth/admin-restricted-operation' ||
      code === 'auth/configuration-not-found'
    ) {
      let existingGuestUid: string | undefined;
      try {
        const raw = localStorage.getItem(LOCAL_GUEST_KEY);
        if (raw) {
          existingGuestUid = (JSON.parse(raw) as { uid?: string }).uid;
        }
      } catch {
        // ignore
      }
      const { uid, sessionToken } = await exchangeServerSession(existingGuestUid, true);
      const guestUser: AppUser = {
        uid,
        username: cleanName,
        avatar: avatarId,
        isAnonymous: true,
        email: null,
        gamesPlayed: 0,
        wins: 0,
        sessionToken,
        authSource: 'guest_session',
      };
      try {
        localStorage.setItem(LOCAL_GUEST_KEY, JSON.stringify(guestUser));
      } catch {
        // ignore
      }
      return guestUser;
    }
    throw err;
  }
}

export async function loginWithGoogle(): Promise<AppUser> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return buildAppUserFromFirebase(cred.user);
}

export async function registerWithEmail(
  email: string,
  password: string,
  username: string,
  avatar: string
): Promise<AppUser> {
  const cleanName = username.trim().slice(0, 24);
  if (cleanName.length < 2) {
    throw new Error('Username must be at least 2 characters.');
  }
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
  return buildAppUserFromFirebase(cred.user, cleanName, avatar);
}

export async function loginWithEmail(email: string, password: string): Promise<AppUser> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return buildAppUserFromFirebase(cred.user);
}

export async function updateUserProfileData(
  current: AppUser,
  username: string,
  avatar: string
): Promise<AppUser> {
  const cleanName = username.trim().slice(0, 24);
  if (cleanName.length < 2) {
    throw new Error('Username must be at least 2 characters.');
  }
  saveStoredPrefs({ username: cleanName, avatar });

  if (current.authSource === 'firebase' && auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: cleanName }).catch(() => {});
    await syncUserToFirestore(auth.currentUser, cleanName, avatar);
  } else {
    try {
      localStorage.setItem(
        LOCAL_GUEST_KEY,
        JSON.stringify({ ...current, username: cleanName, avatar })
      );
    } catch {
      // ignore
    }
  }

  return { ...current, username: cleanName, avatar };
}

export async function restoreFallbackGuestSession(): Promise<AppUser | null> {
  try {
    const raw = localStorage.getItem(LOCAL_GUEST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as AppUser;
    if (!saved.uid) return null;
    const { uid, sessionToken } = await exchangeServerSession(saved.uid, true);
    const prefs = getStoredPrefs();
    return {
      ...saved,
      uid,
      username: prefs.username || saved.username,
      avatar: prefs.avatar || saved.avatar,
      sessionToken,
      authSource: 'guest_session',
    };
  } catch {
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_GUEST_KEY);
  } catch {
    // ignore
  }
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export function subscribeToFirebaseAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
