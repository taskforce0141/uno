import { motion } from 'motion/react';
import { Award, ArrowLeft, LogOut, Play, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';

export function Results({ onLeft }: { onLeft: () => void }) {
  const { user } = useAuth();
  const {
    room,
    gameState,
    playAgain,
    nextRound,
    backToLobby,
    leaveCurrentRoom,
    addToast,
  } = useGame();

  if (!room || !gameState || !user) return null;

  const isHost = room.hostId === user.uid;
  const isRoundOver = gameState.gameStatus === 'round_over';
  const winnerId = isRoundOver ? gameState.roundWinnerId : gameState.winnerId;
  const winner = gameState.players.find((p) => p.id === winnerId);

  const handleAction = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Action failed.', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-10 space-y-8 shadow-2xl"
      >
        {/* Winner Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
            <Award className="w-8 h-8" />
          </div>

          {winner && (
            <PlayerAvatar avatarId={winner.avatar} username={winner.username} size="xl" active />
          )}

          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-500">
              {isRoundOver
                ? `Round ${gameState.roundNumber} Complete`
                : 'Match Winner'}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
              {winner?.username || 'Player'} Wins!
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {gameState.lastAction}
            </p>
          </div>
        </div>

        {/* Final Standings Table */}
        <div className="space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Player Standings
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {gameState.roundStandings.map((row) => (
              <div
                key={row.playerId}
                className="flex items-center justify-between gap-4 px-4 py-3.5 bg-slate-50/70 dark:bg-slate-950/40"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono-tabular text-sm font-bold text-slate-400 w-5">
                    #{row.rank}
                  </span>
                  <PlayerAvatar avatarId={row.avatar} username={row.username} size="sm" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {row.username}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {row.remainingCards} remaining {row.remainingCards === 1 ? 'card' : 'cards'}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono-tabular text-sm font-bold text-slate-900 dark:text-white">
                    {row.totalScore} pts
                  </div>
                  {row.roundPointsGained > 0 && (
                    <div className="font-mono-tabular text-xs text-emerald-500">
                      +{row.roundPointsGained} this round
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {isHost && isRoundOver && (
            <button
              type="button"
              onClick={() => handleAction(nextRound)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors"
            >
              <Play className="w-4 h-4" />
              Start Round {gameState.roundNumber + 1}
            </button>
          )}

          {isHost && !isRoundOver && (
            <button
              type="button"
              onClick={() => handleAction(playAgain)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>
          )}

          {isHost && (
            <button
              type="button"
              onClick={() => handleAction(backToLobby)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Lobby
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              await leaveCurrentRoom();
              onLeft();
            }}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Leave Room
          </button>
        </div>

        {!isHost && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Waiting for the host to start another match or return to the lobby.
          </p>
        )}
      </motion.div>
    </div>
  );
}
