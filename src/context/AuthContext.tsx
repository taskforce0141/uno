import React, { createContext, useCallback, useEffect, useState } from 'react';
import {
  AppUser,
  buildAppUserFromFirebase,
  loginAsGuest,
  loginWithEmail,
  loginWithGoogle,
  logoutUser,
  registerWithEmail,
  restoreFallbackGuestSession,
  subscribeToFirebaseAuth,
  updateUserProfileData,
} from '../services/authService';
import { logAuthDiagnostics } from '../services/sessionService';
import { soundFx } from '../utils/soundFx';

export type ThemeMode = 'dark' | 'light';

interface AuthContextValue {
  user: AppUser | null;
  authReady: boolean;
  theme: ThemeMode;
  soundEnabled: boolean;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleSound: () => void;
  signInGuest: (username: string, avatar: string) => Promise<AppUser>;
  signInGoogle: () => Promise<AppUser>;
  signInEmail: (email: string, password: string) => Promise<AppUser>;
  signUpEmail: (email: string, password: string, username: string, avatar: string) => Promise<AppUser>;
  updateProfile: (username: string, avatar: string) => Promise<AppUser>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('uno_arena_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore
    }
    return 'dark';
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('uno_arena_sound');
      if (saved !== null) {
        const val = saved === 'true';
        soundFx.enabled = val;
        return val;
      }
    } catch {
      // ignore
    }
    return true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('uno_arena_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundFx.enabled = next;
      try {
        localStorage.setItem('uno_arena_sound', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const explicitAuthRef = React.useRef(false);

  useEffect(() => {
    const unsub = subscribeToFirebaseAuth(async (firebaseUser) => {
      if (firebaseUser) {
        if (explicitAuthRef.current) {
          setAuthReady(true);
          return;
        }
        try {
          const appUser = await buildAppUserFromFirebase(firebaseUser);
          setUser(appUser);
        } catch (err) {
          logAuthDiagnostics('onAuthStateChanged profile hydration error', {
            errorMessage: err instanceof Error ? err.message : String(err),
            firebaseCode: (err as { code?: string })?.code,
          });
        } finally {
          setAuthReady(true);
        }
      } else {
        const guest = await restoreFallbackGuestSession();
        setUser(guest);
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  const signInGuest = useCallback(async (username: string, avatar: string) => {
    explicitAuthRef.current = true;
    try {
      const u = await loginAsGuest(username, avatar);
      setUser(u);
      return u;
    } finally {
      explicitAuthRef.current = false;
    }
  }, []);

  const signInGoogle = useCallback(async () => {
    explicitAuthRef.current = true;
    try {
      const u = await loginWithGoogle();
      setUser(u);
      return u;
    } finally {
      explicitAuthRef.current = false;
    }
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    explicitAuthRef.current = true;
    try {
      const u = await loginWithEmail(email, password);
      setUser(u);
      return u;
    } finally {
      explicitAuthRef.current = false;
    }
  }, []);

  const signUpEmail = useCallback(
    async (email: string, password: string, username: string, avatar: string) => {
      explicitAuthRef.current = true;
      try {
        const u = await registerWithEmail(email, password, username, avatar);
        setUser(u);
        return u;
      } finally {
        explicitAuthRef.current = false;
      }
    },
    []
  );

  const updateProfile = useCallback(
    async (username: string, avatar: string) => {
      if (!user) throw new Error('Not signed in.');
      const updated = await updateUserProfileData(user, username, avatar);
      setUser(updated);
      return updated;
    },
    [user]
  );

  const handleSignOut = useCallback(async () => {
    await logoutUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        theme,
        soundEnabled,
        toggleTheme,
        setTheme,
        toggleSound,
        signInGuest,
        signInGoogle,
        signInEmail,
        signUpEmail,
        updateProfile,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
