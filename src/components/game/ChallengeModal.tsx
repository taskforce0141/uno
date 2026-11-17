import { PublicPlayerState } from '../../engine/gameTypes';

export function ChallengeModal({
  open,
  offender,
  previousColor,
  drawCount,
  onDecision,
}: {
  open: boolean;
  offender?: PublicPlayerState;
  previousColor: string;
  drawCount: number;
  onDecision: (challenge: boolean) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Wild Draw Four Played
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-900 dark:text-white">
              {offender?.username || 'Opponent'}
            </span>{' '}
            played Wild +{drawCount} while the active color was{' '}
            <span className="font-semibold uppercase">{previousColor}</span>. Do you believe they bluffed and still held a {previousColor} card?
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <div>If guilty: offender draws {drawCount} cards and you keep your turn.</div>
          <div>If honest: you draw {drawCount + 2} cards and skip your turn.</div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => onDecision(false)}
            className="py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-sm font-semibold transition-colors"
          >
            Accept +{drawCount}
          </button>
          <button
            type="button"
            onClick={() => onDecision(true)}
            className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors"
          >
            Challenge Bluff
          </button>
        </div>
      </div>
    </div>
  );
}
