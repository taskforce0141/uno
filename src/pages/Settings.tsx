import React, { useState } from 'react';
import { LogOut, Moon, Sun, Volume2, VolumeX } from 'lucide-react';
import { AVATAR_OPTIONS } from '../engine/gameTypes';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';

export function Settings({ onGoLogin }: { onGoLogin: () => void }) {
  const { user, theme, toggleTheme, soundEnabled, toggleSound, updateProfile, signOut } =
    useAuth();
  const { addToast } = useGame();

  const [username, setUsername] = useState(user?.username || '');
  const [avatar, setAvatar] = useState(user?.avatar || AVATAR_OPTIONS[0].id);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(username, avatar);
      addToast('Profile settings saved.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Unable to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6">
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Settings & Profile
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Manage your player identity, audio feedback, and visual theme.
          </p>
        </div>

        {/* Audio & Visual Theme */}
        <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 px-4">
          <div className="py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Sound Effects
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Card play, draw, flip, UNO call, and victory audio cues
              </div>
            </div>
            <button
              type="button"
              onClick={toggleSound}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              {soundEnabled ? 'Enabled' : 'Muted'}
            </button>
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Appearance Theme
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Switch between Dark Arena and Light Surface modes
              </div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white"
            >
              {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>
        </div>

        {/* Player Profile */}
        {user ? (
          <form onSubmit={handleSave} className="space-y-5 pt-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  Player Identity
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {user.isAnonymous ? 'Guest Account' : user.email} · ID: {user.uid.slice(0, 12)}
                </p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                Display Username
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Avatar
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
                        : 'border-slate-200 dark:border-slate-800'
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
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        ) : (
          <div className="pt-2">
            <button
              type="button"
              onClick={onGoLogin}
              className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
            >
              Sign In or Play as Guest
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
