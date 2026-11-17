import React, { useState } from 'react';
import { AVATAR_OPTIONS } from '../engine/gameTypes';
import { useAuth } from '../hooks/useAuth';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';

export function Login({
  onSuccess,
  pendingRoomCode,
}: {
  onSuccess: () => void;
  pendingRoomCode?: string | null;
}) {
  const { signInGuest, signInGoogle, signInEmail, signUpEmail } = useAuth();
  const [tab, setTab] = useState<'guest' | 'email'>('guest');
  const [emailMode, setEmailMode] = useState<'login' | 'register'>('login');

  const [username, setUsername] = useState('Player');
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0].id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInGuest(username, avatar);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start guest session.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signInGoogle();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (emailMode === 'register') {
        await signUpEmail(email, password, username, avatar);
      } else {
        await signInEmail(email, password);
      }
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      if (msg.includes('operation-not-allowed') || msg.includes('admin-restricted-operation')) {
        setError(
          'Email/Password sign-in is not yet enabled in the Firebase Console. Use "Play as Guest" or "Continue with Google" right now.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-10 sm:py-14">
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6 shadow-xl">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            {pendingRoomCode ? `Join Room ${pendingRoomCode}` : 'Enter UNO ARENA'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Jump straight in as a guest without registration, or sign in with your account.
          </p>
        </div>

        {/* Segmented Auth Tabs */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => {
              setTab('guest');
              setError('');
            }}
            className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === 'guest'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Play as Guest
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('email');
              setError('');
            }}
            className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === 'email'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Account Sign In
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-500">
            {error}
          </div>
        )}

        {tab === 'guest' ? (
          <form onSubmit={handleGuestSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                Guest Username
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your player name"
                className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Choose Avatar
              </label>
              <div className="grid grid-cols-4 gap-2.5">
                {AVATAR_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAvatar(opt.id)}
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                      avatar === opt.id
                        ? 'border-rose-500 bg-rose-500/10'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-400'
                    }`}
                  >
                    <PlayerAvatar avatarId={opt.id} username={username || opt.label} size="sm" />
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate w-full text-center">
                      {opt.label.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors"
            >
              {loading ? 'Entering Arena...' : 'Play as Guest'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                {emailMode === 'login' ? 'Sign in with email' : 'Create a new account'}
              </span>
              <button
                type="button"
                onClick={() => setEmailMode(emailMode === 'login' ? 'register' : 'login')}
                className="font-semibold text-rose-500 hover:underline"
              >
                {emailMode === 'login' ? 'Need an account? Register' : 'Already registered? Sign In'}
              </button>
            </div>

            {emailMode === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={24}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              {loading
                ? 'Authenticating...'
                : emailMode === 'login'
                ? 'Sign In'
                : 'Create Account'}
            </button>
          </form>
        )}

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white dark:bg-slate-900 px-3 text-slate-500">or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold text-sm transition-colors"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
