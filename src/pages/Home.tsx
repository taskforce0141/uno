import {
  ArrowRight,
  BookOpen,
  Layers,
  Lock,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Sun,
  Moon,
  Users,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AppRoute } from '../components/layout/TopNav';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';
import { useState } from 'react';

export function Home({
  onNavigate,
  activeRoomCode,
}: {
  onNavigate: (route: AppRoute) => void;
  activeRoomCode?: string | null;
}) {
  const { user, theme, toggleTheme, soundEnabled, toggleSound } = useAuth();
  const [tableImgError, setTableImgError] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-12">
      {/* Hero Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-between rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-10 space-y-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Private Invite-Only Rooms</span>
              <span aria-hidden="true">·</span>
              <span>2 to 10 Players</span>
              <span aria-hidden="true">·</span>
              <span>Free to Play</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.08] text-balance">
              Real-Time Multiplayer UNO With Your Friends
            </h1>

            <p className="text-base text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
              Launch an encrypted private table in seconds. Share a 6-character code or QR link, pick Classic UNO, two-sided UNO Flip, or build your own house rules.
            </p>
          </div>

          {/* Primary Actions */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {activeRoomCode ? (
                <button
                  type="button"
                  onClick={() => onNavigate('lobby')}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
                >
                  Return to Room {activeRoomCode}
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(user ? 'create' : 'login')}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Play Now
                </button>
              )}

              <button
                type="button"
                onClick={() => onNavigate('create')}
                className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 font-semibold text-sm transition-opacity whitespace-nowrap shrink-0"
              >
                Create Private Room
              </button>

              <button
                type="button"
                onClick={() => onNavigate('join')}
                className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
              >
                Join Room
              </button>
            </div>

            {/* User Profile & Quick Controls Bar */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <PlayerAvatar avatarId={user.avatar} username={user.username} size="sm" />
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {user.username}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {user.isAnonymous ? 'Guest Session' : user.email || 'Registered Player'}
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('login')}
                  className="text-sm font-semibold text-rose-500 hover:underline"
                >
                  Sign in or enter as Guest
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSound}
                  aria-label={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  {soundEnabled ? 'Sound On' : 'Muted'}
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Toggle color theme"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  {theme === 'dark' ? 'Dark' : 'Light'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  aria-label="Open settings"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <SettingsIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Hero Visual Panel */}
        <div className="lg:col-span-5 relative rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 min-h-[280px] flex flex-col justify-end">
          {!tableImgError ? (
            <img
              src="/src/assets/images/arena_table_felt_1794882232232.jpg"
              alt="UNO ARENA tabletop view"
              referrerPolicy="no-referrer"
              onError={() => setTableImgError(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-rose-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/40 to-transparent" />

          <div className="relative z-10 p-6 sm:p-8 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-16 rounded-xl bg-rose-600 border-2 border-white flex items-center justify-center font-display font-extrabold text-white text-xl shadow-lg -rotate-6">
                +4
              </div>
              <div className="w-12 h-16 rounded-xl bg-teal-600 border-2 border-slate-900 flex items-center justify-center font-display font-extrabold text-white text-xs shadow-lg rotate-3">
                FLIP
              </div>
              <div className="w-12 h-16 rounded-xl bg-amber-500 border-2 border-white flex items-center justify-center font-display font-extrabold text-white text-xl shadow-lg rotate-12">
                7
              </div>
            </div>
            <h2 className="font-display text-xl font-bold text-white">
              Server-Validated Private Tables
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every card draw, turn timer, Flip transition, and Wild +4 challenge is enforced server-side. Other players never see your hand.
            </p>
          </div>
        </div>
      </section>

      {/* Game Modes Showcase */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Three Distinct Game Modes
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Hosts choose the mode and house rules inside any private room.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('how-to-play')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-500 hover:underline"
          >
            <BookOpen className="w-4 h-4" />
            Read Full Rules Guide
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Classic UNO
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              108-card traditional deck with Red, Blue, Green, and Yellow suits, Skip, Reverse, Draw Two, Wild, and Wild Draw Four challenges.
            </p>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              UNO Flip
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Two-sided cards switching between Light Side (Draw One, Wild +2) and Dark Side (Pink, Teal, Orange, Purple, Draw Five, Skip Everyone, Wild Draw Color).
            </p>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Custom UNO
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Configure +2/+4 stacking, Jump-In out-of-turn plays, Seven-O hand swapping and rotation, Draw Until Playable, multi-card drops, and score targets.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works & Security Guarantees */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 border-t border-slate-200 dark:border-slate-800 pt-8">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Private Rooms Only</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              No public lobby listing. Only friends with your 6-character code or direct invite URL can enter.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Up to 10 Friends</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Join instantly as a guest or registered player. Works across desktop, tablet, and mobile browsers.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Fair-Play Engine</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Hands remain strictly private per player. All moves and turn timers are validated on the server.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
