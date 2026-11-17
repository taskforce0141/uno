import { PublicPlayerState } from '../../engine/gameTypes';
import { PlayerAvatar } from '../ui/PlayerAvatar';

export function SwapTargetModal({
  open,
  players,
  myId,
  onSelect,
}: {
  open: boolean;
  players: PublicPlayerState[];
  myId: string;
  onSelect: (targetId: string) => void;
}) {
  if (!open) return null;
  const targets = players.filter((p) => !p.isSpectator && p.id !== myId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Seven-O Hand Swap
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You played a 7! Choose a player to swap your entire hand with.
          </p>
        </div>

        <div className="space-y-2.5">
          {targets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-rose-500/10 border border-slate-200 dark:border-slate-700 hover:border-rose-500 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <PlayerAvatar avatarId={p.avatar} username={p.username} size="sm" />
                <span className="font-semibold text-slate-900 dark:text-white truncate">
                  {p.username}
                </span>
              </div>
              <span className="font-mono-tabular text-sm font-bold text-slate-600 dark:text-slate-300 shrink-0">
                {p.cardCount} {p.cardCount === 1 ? 'card' : 'cards'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
