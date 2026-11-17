import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { PlayerAvatar } from '../ui/PlayerAvatar';

export type AppRoute =
  | 'home'
  | 'login'
  | 'create'
  | 'join'
  | 'lobby'
  | 'game'
  | 'results'
  | 'settings'
  | 'how-to-play';

export function TopNav({
  currentRoute,
  onNavigate,
  inRoom,
}: {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  inRoom: boolean;
}) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: { route: AppRoute; label: string }[] = [
    { route: 'home', label: 'Home' },
    { route: 'create', label: 'Create Room' },
    { route: 'join', label: 'Join Room' },
    { route: 'how-to-play', label: 'How to Play' },
    { route: 'settings', label: 'Settings' },
  ];

  const handleNav = (route: AppRoute) => {
    setMobileOpen(false);
    onNavigate(route);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg"
        >
          UNO <span className="text-rose-500">ARENA</span>
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item) => {
            const active = currentRoute === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => handleNav(item.route)}
                className={`whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
                  active
                    ? 'text-slate-900 dark:text-white border-rose-500'
                    : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action or user profile trigger */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => handleNav(inRoom ? 'lobby' : 'settings')}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <PlayerAvatar avatarId={user.avatar} username={user.username} size="xs" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 max-w-[120px] truncate">
                {user.username}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNav('login')}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Play as Guest
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            className="md:hidden p-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120] px-4 py-3 flex flex-col gap-1">
          {navItems.map((item) => (
            <button
              key={item.route}
              type="button"
              onClick={() => handleNav(item.route)}
              className={`text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                currentRoute === item.route
                  ? 'bg-rose-500/10 text-rose-500'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
