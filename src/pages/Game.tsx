import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  LogOut,
  MessageSquare,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CardColor, PublicGameState, UnoCard } from '../engine/gameTypes';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { CARD_COLOR_STYLES, getFaceForDisplay } from '../utils/cardUtils';
import { UnoCardView } from '../components/cards/UnoCardView';
import { ColorPickerModal } from '../components/cards/ColorPickerModal';
import { SwapTargetModal } from '../components/game/SwapTargetModal';
import { ChallengeModal } from '../components/game/ChallengeModal';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';
import { ConfirmModal } from '../components/ui/ConfirmModal';

function canPlayCardLocally(card: UnoCard, gameState: PublicGameState, myId: string): boolean {
  if (gameState.gameStatus !== 'playing') return false;
  if (gameState.pendingColorChoiceBy || gameState.pendingSwapBy || gameState.pendingChallenge) {
    return false;
  }

  const face = getFaceForDisplay(card, gameState.currentSide);
  const top = gameState.discardTopCard;
  const topFace = top ? getFaceForDisplay(top, gameState.currentSide) : null;

  if (gameState.currentPlayerId !== myId) {
    // Check Jump-In eligibility
    if (!gameState.rules.jumpIn || gameState.pendingDrawCount > 0 || !topFace) return false;
    if (face.color === 'wild' || topFace.color === 'wild') return false;
    return face.color === topFace.color && face.value === topFace.value;
  }

  if (gameState.hasDrawnThisTurnBy === myId && gameState.drawnCardPlayableId) {
    return card.id === gameState.drawnCardPlayableId;
  }

  if (gameState.pendingDrawCount > 0 && gameState.pendingDrawSource) {
    if (gameState.gameMode === 'flip') {
      return (
        gameState.pendingDrawSource === 'draw2' &&
        gameState.rules.stackDrawTwo &&
        face.value === 'draw2'
      );
    }
    if (gameState.pendingDrawSource === 'draw2') {
      if (gameState.rules.stackDrawTwo && face.value === 'draw2') return true;
      if (gameState.rules.stackDrawTwoAndFour && face.value === 'wild4') return true;
      return false;
    }
    if (gameState.pendingDrawSource === 'wild4') {
      if (gameState.rules.stackDrawFour && face.value === 'wild4') return true;
      if (gameState.rules.stackDrawTwoAndFour && face.value === 'draw2') return true;
      return false;
    }
    return false;
  }

  if (face.color === 'wild') return true;
  if (face.color === gameState.currentColor) return true;
  if (topFace && face.value === topFace.value) return true;
  return false;
}

export function Game({ onLeave }: { onLeave: () => void }) {
  const { user, soundEnabled, toggleSound } = useAuth();
  const {
    room,
    gameState,
    hand,
    playCards,
    drawCard,
    chooseColor,
    swapHands,
    challengeWild4,
    callUno,
    catchUno,
    passTurn,
    sendGameAction,
    leaveCurrentRoom,
  } = useGame();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [localColorPromptCards, setLocalColorPromptCards] = useState<string[] | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [mobileLogOpen, setMobileLogOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const lastTimeoutSeqRef = useRef<number>(-1);

  useEffect(() => {
    setSelectedIds([]);
  }, [gameState?.actionSeq, hand.length]);

  useEffect(() => {
    if (!gameState?.turnExpiresAt) {
      setSecondsLeft(null);
      return;
    }
    const update = () => {
      const rem = Math.max(0, Math.ceil((gameState.turnExpiresAt! - Date.now()) / 1000));
      setSecondsLeft(rem);
    };
    update();
    const timer = window.setInterval(update, 400);
    return () => window.clearInterval(timer);
  }, [gameState?.turnExpiresAt]);

  useEffect(() => {
    if (!gameState || !user || user.sessionToken) return;
    if (gameState.gameStatus !== 'playing' || !gameState.turnExpiresAt) return;
    if (secondsLeft === null || secondsLeft > 0) return;
    if (lastTimeoutSeqRef.current === gameState.actionSeq) return;

    const seq = gameState.actionSeq;
    const timer = window.setTimeout(() => {
      if (lastTimeoutSeqRef.current === seq) return;
      lastTimeoutSeqRef.current = seq;
      sendGameAction('timeout', { expectedSeq: seq });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [gameState, user, secondsLeft, sendGameAction]);

  const opponents = useMemo(() => {
    if (!gameState || !user) return [];
    const idx = gameState.players.findIndex((p) => p.id === user.uid);
    if (idx === -1) return gameState.players.filter((p) => !p.isSpectator);
    const ordered = [
      ...gameState.players.slice(idx + 1),
      ...gameState.players.slice(0, idx),
    ];
    return ordered.filter((p) => !p.isSpectator && p.id !== user.uid);
  }, [gameState, user]);

  if (!room || !gameState || !user) return null;

  const myPlayer = gameState.players.find((p) => p.id === user.uid);
  const isSpectator = Boolean(myPlayer?.isSpectator);
  const isMyTurn = !isSpectator && gameState.currentPlayerId === user.uid;
  const activePlayer = gameState.players.find((p) => p.id === gameState.currentPlayerId);
  const colorStyle = CARD_COLOR_STYLES[gameState.currentColor] || CARD_COLOR_STYLES.red;
  const isDarkSide = gameState.currentSide === 'dark';
  const multiAllowed = gameState.rules.allowMultipleIdentical;

  const handleCardClick = (card: UnoCard) => {
    if (isSpectator) return;
    const playable = canPlayCardLocally(card, gameState, user.uid);
    if (!playable) return;

    const face = getFaceForDisplay(card, gameState.currentSide);

    if (!multiAllowed) {
      if (face.color === 'wild') {
        setLocalColorPromptCards([card.id]);
      } else {
        playCards([card.id]);
      }
      return;
    }

    // Multi-card mode
    if (selectedIds.includes(card.id)) {
      const next = selectedIds.filter((id) => id !== card.id);
      setSelectedIds(next);
      return;
    }

    if (selectedIds.length === 0) {
      setSelectedIds([card.id]);
      return;
    }

    const firstCard = hand.find((c) => c.id === selectedIds[0]);
    if (firstCard) {
      const firstFace = getFaceForDisplay(firstCard, gameState.currentSide);
      if (firstFace.color === face.color && firstFace.value === face.value) {
        setSelectedIds([...selectedIds, card.id]);
      } else {
        setSelectedIds([card.id]);
      }
    }
  };

  const handlePlaySelected = () => {
    if (selectedIds.length === 0) return;
    const first = hand.find((c) => c.id === selectedIds[0]);
    if (!first) return;
    const face = getFaceForDisplay(first, gameState.currentSide);
    if (face.color === 'wild') {
      setLocalColorPromptCards(selectedIds);
    } else {
      playCards(selectedIds);
      setSelectedIds([]);
    }
  };

  const handleColorPick = (color: CardColor) => {
    if (localColorPromptCards) {
      playCards(localColorPromptCards, color);
      setLocalColorPromptCards(null);
      setSelectedIds([]);
    } else if (gameState.pendingColorChoiceBy === user.uid) {
      chooseColor(color);
    }
  };

  const showColorModal =
    Boolean(localColorPromptCards) || gameState.pendingColorChoiceBy === user.uid;

  const vulnerableOpponents = opponents.filter((o) => o.unoVulnerable && o.cardCount === 1);
  const canShoutUno =
    !isSpectator &&
    hand.length > 0 &&
    hand.length <= 2 &&
    !myPlayer?.calledUno;

  return (
    <div
      className={`min-h-[calc(100vh-4rem)] flex flex-col transition-colors duration-300 ${
        isDarkSide
          ? 'bg-[#120A24] text-slate-100'
          : 'bg-slate-100 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100'
      }`}
    >
      {/* Top Arena HUD */}
      <div className="border-b border-slate-200 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md px-3 sm:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono-tabular font-bold text-slate-700 dark:text-slate-200">
                  {room.roomCode}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{room.gameMode.toUpperCase()}</span>
                {room.gameMode === 'flip' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-bold ${
                        isDarkSide ? 'text-fuchsia-400' : 'text-amber-500'
                      }`}
                    >
                      {isDarkSide ? 'DARK SIDE' : 'LIGHT SIDE'}
                    </span>
                  </>
                )}
              </div>
              <div className="text-sm font-bold truncate">{room.roomName}</div>
            </div>
          </div>

          {/* Active Color + Direction + Timer */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <span
                className={`w-4 h-4 rounded-full ${colorStyle.bg} ring-2 ring-white/40`}
                aria-hidden="true"
              />
              <span className="text-xs sm:text-sm font-bold">{colorStyle.label}</span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              {gameState.currentDirection === 1 ? (
                <RotateCw className="w-4 h-4 text-blue-400" />
              ) : (
                <RotateCcw className="w-4 h-4 text-amber-400" />
              )}
              <span>{gameState.currentDirection === 1 ? 'Clockwise' : 'Counter-Clockwise'}</span>
            </div>

            {secondsLeft !== null && (
              <div
                className={`flex items-center gap-1 font-mono-tabular text-xs sm:text-sm font-bold ${
                  secondsLeft <= 7 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {secondsLeft}s
              </div>
            )}

            <button
              type="button"
              onClick={toggleSound}
              aria-label="Toggle sound"
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setMobileLogOpen((v) => !v)}
              aria-label="Toggle activity log"
              className="lg:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <MessageSquare className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              aria-label="Leave game"
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-500/20 text-slate-600 dark:text-slate-300 hover:text-rose-500"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Arena + Desktop Side Log */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex flex-col lg:flex-row gap-4 p-3 sm:p-5 overflow-hidden">
        {/* Table Column */}
        <div className="flex-1 flex flex-col justify-between gap-4 min-w-0">
          {/* Opponents Arc / Strip */}
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-1 justify-start sm:justify-center">
            {opponents.map((opp) => {
              const isTurn = gameState.currentPlayerId === opp.id;
              return (
                <div
                  key={opp.id}
                  className={`shrink-0 rounded-2xl p-2.5 sm:p-3 border transition-all min-w-[128px] sm:min-w-[148px] ${
                    isTurn
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg'
                      : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <PlayerAvatar
                      avatarId={opp.avatar}
                      username={opp.username}
                      size="sm"
                      active={isTurn}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{opp.username}</div>
                      <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                        {opp.cardCount} {opp.cardCount === 1 ? 'card' : 'cards'}
                        {opp.calledUno ? ' · UNO!' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Mini card backs */}
                  <div className="flex items-center gap-0.5 mt-2 h-4 overflow-hidden">
                    {Array.from({ length: Math.min(7, opp.cardCount) }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-2.5 h-4 rounded-[2px] border ${
                          isDarkSide
                            ? 'bg-purple-900 border-fuchsia-400/50'
                            : 'bg-slate-800 border-white/50'
                        }`}
                      />
                    ))}
                    {opp.cardCount > 7 && (
                      <span className="text-[10px] font-mono-tabular text-slate-400 ml-1">
                        +{opp.cardCount - 7}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center Table Surface (Discard + Draw Piles + Turn Banner) */}
          <div className="relative flex-1 min-h-[230px] sm:min-h-[280px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 flex flex-col items-center justify-center p-4 sm:p-6 gap-5 overflow-hidden">
            {/* Turn & Action Banner */}
            <div className="text-center space-y-1 z-10">
              <div className="text-sm sm:text-base font-display font-bold">
                {isMyTurn ? (
                  <span className="text-emerald-500">Your Turn — Play a card or draw</span>
                ) : (
                  <span>
                    Waiting for{' '}
                    <span className="text-amber-400">{activePlayer?.username || 'Player'}</span>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto truncate">
                {gameState.lastAction}
              </div>
            </div>

            {/* Draw & Discard Piles */}
            <div className="flex items-center justify-center gap-6 sm:gap-10 z-10">
              {/* Draw Pile */}
              <div className="flex flex-col items-center gap-2">
                <UnoCardView
                  faceDown
                  side={gameState.currentSide}
                  size="lg"
                  onClick={isMyTurn && gameState.hasDrawnThisTurnBy !== user.uid ? drawCard : undefined}
                />
                <div className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                  Deck: {gameState.drawPileCount}
                </div>
              </div>

              {/* Discard Pile */}
              <div className="flex flex-col items-center gap-2">
                <AnimatePresence mode="popLayout">
                  {gameState.discardTopCard && (
                    <motion.div
                      key={`${gameState.discardTopCard.id}_${gameState.currentSide}`}
                      initial={{ scale: 0.85, opacity: 0.6 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.18 }}
                    >
                      <UnoCardView
                        card={gameState.discardTopCard}
                        side={gameState.currentSide}
                        size="lg"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Active: <span className={`font-bold ${colorStyle.text}`}>{colorStyle.label}</span>
                </div>
              </div>
            </div>

            {/* Pending Stack / Catch UNO / Pass Turn Action Strip */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 z-10">
              {gameState.pendingDrawCount > 0 && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs sm:text-sm font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  Incoming +{gameState.pendingDrawCount} Stack
                  {isMyTurn && (
                    <button
                      type="button"
                      onClick={drawCard}
                      className="ml-2 px-2.5 py-1 rounded-lg bg-white text-rose-700 text-xs font-bold"
                    >
                      Draw +{gameState.pendingDrawCount}
                    </button>
                  )}
                </div>
              )}

              {gameState.hasDrawnThisTurnBy === user.uid && !gameState.rules.forcePlayAfterDraw && (
                <button
                  type="button"
                  onClick={passTurn}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-semibold"
                >
                  Keep Card & Pass
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              {vulnerableOpponents.map((opp) => (
                <button
                  key={opp.id}
                  type="button"
                  onClick={() => catchUno(opp.id)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-extrabold transition-colors"
                >
                  Catch {opp.username} (Forgot UNO!)
                </button>
              ))}
            </div>
          </div>

          {/* Player Hand & Controls */}
          {!isSpectator ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
                  <span>Your Hand</span>
                  <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                    ({hand.length} {hand.length === 1 ? 'card' : 'cards'})
                  </span>
                  {multiAllowed && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      · Multi-card enabled
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {multiAllowed && selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handlePlaySelected}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold transition-colors"
                    >
                      Play Selected ({selectedIds.length})
                    </button>
                  )}

                  {canShoutUno && (
                    <button
                      type="button"
                      onClick={callUno}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-extrabold tracking-wide transition-colors"
                    >
                      Call UNO!
                    </button>
                  )}

                  {myPlayer?.calledUno && hand.length <= 2 && (
                    <span className="text-xs font-bold text-emerald-500">UNO Called</span>
                  )}
                </div>
              </div>

              {/* Horizontally scrollable on mobile, wrapping nicely on desktop */}
              <div className="flex items-end gap-2 sm:gap-2.5 overflow-x-auto sm:flex-wrap sm:justify-center py-3 px-1 min-h-[128px] sm:min-h-[156px]">
                {hand.map((card) => {
                  const playable = canPlayCardLocally(card, gameState, user.uid);
                  const isSelected = selectedIds.includes(card.id);
                  return (
                    <div key={card.id} className="shrink-0">
                      <UnoCardView
                        card={card}
                        side={gameState.currentSide}
                        playable={playable}
                        selected={isSelected}
                        dimmed={!playable && isMyTurn}
                        size="md"
                        onClick={playable ? () => handleCardClick(card) : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
              Spectator Mode — Watching live match
            </div>
          )}
        </div>

        {/* Desktop Activity Side Panel */}
        <aside className="hidden lg:flex lg:w-80 flex-col rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 overflow-hidden max-h-[calc(100vh-8rem)]">
          <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-display font-bold text-sm">Activity Log</h3>
            <span className="font-mono-tabular text-xs text-slate-500">
              Round {gameState.roundNumber}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1">
            {gameState.activityLog.map((entry) => (
              <div
                key={entry.id}
                className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800/60 pb-2 last:border-b-0"
              >
                {entry.message}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Mobile Activity Log Drawer */}
      {mobileLogOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 flex justify-end">
          <div className="w-80 max-w-full bg-white dark:bg-slate-900 h-full p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display font-bold">Activity Log</h3>
              <button
                type="button"
                onClick={() => setMobileLogOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
              {gameState.activityLog.map((entry) => (
                <div
                  key={entry.id}
                  className="text-xs text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2"
                >
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals for Interactive Game Mechanics */}
      <ColorPickerModal
        open={showColorModal}
        side={gameState.currentSide}
        onSelect={handleColorPick}
        onCancel={localColorPromptCards ? () => setLocalColorPromptCards(null) : undefined}
      />

      <SwapTargetModal
        open={gameState.pendingSwapBy === user.uid}
        players={gameState.players}
        myId={user.uid}
        onSelect={swapHands}
      />

      <ChallengeModal
        open={gameState.pendingChallenge?.challengerId === user.uid}
        offender={gameState.players.find((p) => p.id === gameState.pendingChallenge?.offenderId)}
        previousColor={gameState.pendingChallenge?.previousColor || 'red'}
        drawCount={gameState.pendingChallenge?.drawCount || 4}
        onDecision={challengeWild4}
      />

      <ConfirmModal
        open={confirmLeave}
        title="Leave Active Match?"
        message="You will leave the match and your remaining cards will be returned to the deck."
        confirmLabel="Leave Match"
        destructive
        onConfirm={async () => {
          setConfirmLeave(false);
          await leaveCurrentRoom();
          onLeave();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
