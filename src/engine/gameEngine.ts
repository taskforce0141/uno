import { DARK_COLORS, LIGHT_COLORS } from './gameTypes.ts';
import type {
  ActivityEntry,
  CardColor,
  CustomRulesConfig,
  GameMode,
  PlayerRecord,
  PublicGameState,
  PublicPlayerState,
  RoundStanding,
  ServerGameState,
  UnoCard,
} from './gameTypes.ts';
import { createClassicDeck, createFlipDeck, drawCardsFromPile } from './deck.ts';
import {
  areCardsIdenticalForMultiPlay,
  calculateHandPoints,
  getCardFace,
  hadMatchingColorInHand,
  isCardPlayable,
  isJumpInEligible,
} from './validation.ts';
import { flipGameSide, getColorsForSide } from './flipUno.ts';
import { resolveRulesForMode } from './customRules.ts';

export class GameEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameEngineError';
  }
}

function getActivePlayers(state: Pick<ServerGameState, 'players'>): PlayerRecord[] {
  return state.players.filter((p) => !p.isSpectator);
}

function getNextPlayerIndex(
  activePlayers: PlayerRecord[],
  currentPlayerId: string,
  direction: 1 | -1,
  steps = 1
): number {
  const len = activePlayers.length;
  if (len === 0) return 0;
  const currentIdx = Math.max(
    0,
    activePlayers.findIndex((p) => p.id === currentPlayerId)
  );
  const raw = (currentIdx + direction * steps) % len;
  return raw < 0 ? raw + len : raw;
}

function getNextPlayerId(
  activePlayers: PlayerRecord[],
  currentPlayerId: string,
  direction: 1 | -1,
  steps = 1
): string {
  const idx = getNextPlayerIndex(activePlayers, currentPlayerId, direction, steps);
  return activePlayers[idx]?.id ?? currentPlayerId;
}

function computeTurnExpiry(rules: CustomRulesConfig, now = Date.now()): number | null {
  if (!rules.turnTimerSeconds || rules.turnTimerSeconds <= 0) {
    return null;
  }
  return now + rules.turnTimerSeconds * 1000;
}

function pushActivity(
  state: ServerGameState,
  playerId: string,
  message: string,
  tone: ActivityEntry['tone'] = 'neutral'
) {
  const entry: ActivityEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    message,
    timestamp: Date.now(),
    tone,
  };
  state.lastAction = message;
  state.activityLog = [entry, ...state.activityLog].slice(0, 40);
}

function getPlayerName(state: ServerGameState, playerId: string): string {
  return state.players.find((p) => p.id === playerId)?.username ?? 'Player';
}

function markActionProcessed(state: ServerGameState, actionId?: string): boolean {
  if (!actionId) return false;
  if (state.processedActionIds.includes(actionId)) {
    return true;
  }
  state.processedActionIds = [...state.processedActionIds.slice(-99), actionId];
  return false;
}

function clearUnoVulnerabilityOnOtherTurn(state: ServerGameState, actingPlayerId: string) {
  for (const pid of Object.keys(state.unoVulnerable)) {
    if (pid !== actingPlayerId) {
      state.unoVulnerable[pid] = false;
    }
  }
}

function finalizeRoundWin(state: ServerGameState, winnerId: string) {
  const active = getActivePlayers(state);
  const side = state.currentSide;
  let roundPoints = 0;

  for (const p of active) {
    if (p.id !== winnerId) {
      roundPoints += calculateHandPoints(state.hands[p.id] ?? [], side);
    }
  }

  state.scores[winnerId] = (state.scores[winnerId] ?? 0) + roundPoints;
  state.roundWinnerId = winnerId;

  const standings: RoundStanding[] = active
    .map((p) => ({
      playerId: p.id,
      username: p.username,
      avatar: p.avatar,
      remainingCards: (state.hands[p.id] ?? []).length,
      roundPointsGained: p.id === winnerId ? roundPoints : 0,
      totalScore: state.scores[p.id] ?? 0,
      rank: 1,
    }))
    .sort((a, b) => {
      if (a.remainingCards !== b.remainingCards) return a.remainingCards - b.remainingCards;
      return b.totalScore - a.totalScore;
    })
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  state.roundStandings = standings;
  state.pendingColorChoiceBy = null;
  state.pendingSwapBy = null;
  state.pendingChallenge = null;
  state.pendingDrawCount = 0;
  state.pendingDrawSource = null;
  state.turnExpiresAt = null;

  const targetReached =
    !state.rules.scoreBasedGame ||
    state.rules.firstPlayerToWin ||
    (state.scores[winnerId] ?? 0) >= state.rules.targetScore;

  if (targetReached) {
    state.gameStatus = 'finished';
    state.winnerId = winnerId;
    pushActivity(
      state,
      winnerId,
      `${getPlayerName(state, winnerId)} wins the match! (+${roundPoints} pts)`,
      'win'
    );
  } else {
    state.gameStatus = 'round_over';
    pushActivity(
      state,
      winnerId,
      `${getPlayerName(state, winnerId)} wins Round ${state.roundNumber}! (+${roundPoints} pts)`,
      'win'
    );
  }
}

export function createInitialGameState(
  roomId: string,
  gameMode: GameMode,
  customRules: Partial<CustomRulesConfig> | undefined,
  players: PlayerRecord[],
  roundNumber = 1,
  existingScores: Record<string, number> = {}
): ServerGameState {
  const rules = resolveRulesForMode(gameMode, customRules);
  const activePlayers = players.filter((p) => !p.isSpectator);
  if (activePlayers.length < 2) {
    throw new GameEngineError('At least 2 active players are required to start.');
  }

  let deck = gameMode === 'flip' ? createFlipDeck() : createClassicDeck();
  const hands: Record<string, UnoCard[]> = {};
  const scores: Record<string, number> = {};
  const calledUno: Record<string, boolean> = {};
  const unoVulnerable: Record<string, boolean> = {};

  for (const p of activePlayers) {
    hands[p.id] = deck.splice(0, rules.startingHandSize);
    scores[p.id] = existingScores[p.id] ?? 0;
    calledUno[p.id] = false;
    unoVulnerable[p.id] = false;
  }

  // Pick a non-wild starting discard card
  let starterIdx = deck.findIndex((c) => {
    const f = c.light;
    return (
      f.color !== 'wild' &&
      f.value !== 'draw2' &&
      f.value !== 'draw1' &&
      f.value !== 'skip' &&
      f.value !== 'reverse' &&
      f.value !== 'flip'
    );
  });
  if (starterIdx === -1) {
    starterIdx = 0;
  }
  const [starterCard] = deck.splice(starterIdx, 1);
  const starterColor: CardColor =
    starterCard.light.color === 'wild' ? LIGHT_COLORS[0] : starterCard.light.color;

  const firstPlayerId = activePlayers[0].id;
  const now = Date.now();

  const state: ServerGameState = {
    roomId,
    gameMode,
    rules,
    gameStatus: 'playing',
    roundNumber,
    currentPlayerId: firstPlayerId,
    currentDirection: 1,
    currentColor: starterColor,
    currentSide: 'light',
    drawPile: deck,
    discardPile: [starterCard],
    hands,
    scores,
    calledUno,
    unoVulnerable,
    pendingDrawCount: 0,
    pendingDrawSource: null,
    pendingColorChoiceBy: null,
    pendingSwapBy: null,
    pendingChallenge: null,
    hasDrawnThisTurnBy: null,
    drawnCardPlayableId: null,
    turnExpiresAt: computeTurnExpiry(rules, now),
    players: [...players],
    winnerId: null,
    roundWinnerId: null,
    roundStandings: [],
    lastAction: `Round ${roundNumber} started`,
    activityLog: [],
    actionSeq: 1,
    processedActionIds: [],
  };

  pushActivity(
    state,
    firstPlayerId,
    `Round ${roundNumber} started! ${getPlayerName(state, firstPlayerId)} goes first.`,
    'action'
  );

  return state;
}

function advanceTurn(state: ServerGameState, steps = 1, fromPlayerId = state.currentPlayerId) {
  const active = getActivePlayers(state);
  state.currentPlayerId = getNextPlayerId(active, fromPlayerId, state.currentDirection, steps);
  state.hasDrawnThisTurnBy = null;
  state.drawnCardPlayableId = null;
  state.turnExpiresAt = computeTurnExpiry(state.rules);
  state.actionSeq += 1;
}

function resolveWildCardAfterColor(
  state: ServerGameState,
  playerId: string,
  playedValue: string,
  count: number,
  previousColor: CardColor,
  wasIllegalBluff: boolean
) {
  const active = getActivePlayers(state);
  const nextPlayerId = getNextPlayerId(active, playerId, state.currentDirection, 1);

  if (playedValue === 'wild') {
    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} played Wild and chose ${state.currentColor.toUpperCase()}`,
      'action'
    );
    advanceTurn(state, 1, playerId);
    return;
  }

  if (playedValue === 'wild2') {
    const { drawn } = drawCardsFromPile(state, 2 * count);
    state.hands[nextPlayerId] = [...(state.hands[nextPlayerId] ?? []), ...drawn];
    state.calledUno[nextPlayerId] = false;
    state.unoVulnerable[nextPlayerId] = false;
    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} played Wild Draw Two (${state.currentColor.toUpperCase()}). ${getPlayerName(state, nextPlayerId)} draws ${drawn.length}!`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
    return;
  }

  if (playedValue === 'wild_draw_color') {
    const drawn: UnoCard[] = [];
    for (let i = 0; i < 30; i++) {
      const res = drawCardsFromPile(state, 1);
      if (res.drawn.length === 0) break;
      const card = res.drawn[0];
      drawn.push(card);
      const face = getCardFace(card, state.currentSide);
      if (face.color === state.currentColor) {
        break;
      }
    }
    state.hands[nextPlayerId] = [...(state.hands[nextPlayerId] ?? []), ...drawn];
    state.calledUno[nextPlayerId] = false;
    state.unoVulnerable[nextPlayerId] = false;
    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} played Wild Draw Color (${state.currentColor.toUpperCase()}). ${getPlayerName(state, nextPlayerId)} drew ${drawn.length} cards!`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
    return;
  }

  if (playedValue === 'wild4') {
    const canStack = state.rules.stackDrawFour || state.rules.stackDrawTwoAndFour;
    if (canStack) {
      state.pendingDrawCount += 4 * count;
      state.pendingDrawSource = 'wild4';
      pushActivity(
        state,
        playerId,
        `${getPlayerName(state, playerId)} played Wild +${4 * count} (${state.currentColor.toUpperCase()})! Stack is at +${state.pendingDrawCount}.`,
        'penalty'
      );
      advanceTurn(state, 1, playerId);
      return;
    }

    if (state.rules.challengeWild4) {
      state.pendingChallenge = {
        offenderId: playerId,
        challengerId: nextPlayerId,
        previousColor,
        wasIllegalBluff,
        drawCount: 4 * count,
      };
      state.currentPlayerId = nextPlayerId;
      state.turnExpiresAt = computeTurnExpiry(state.rules);
      state.actionSeq += 1;
      pushActivity(
        state,
        playerId,
        `${getPlayerName(state, playerId)} played Wild +${4 * count} (${state.currentColor.toUpperCase()}). ${getPlayerName(state, nextPlayerId)} can Accept or Challenge!`,
        'action'
      );
      return;
    }

    const { drawn } = drawCardsFromPile(state, 4 * count);
    state.hands[nextPlayerId] = [...(state.hands[nextPlayerId] ?? []), ...drawn];
    state.calledUno[nextPlayerId] = false;
    state.unoVulnerable[nextPlayerId] = false;
    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} played Wild +${4 * count} (${state.currentColor.toUpperCase()}). ${getPlayerName(state, nextPlayerId)} draws ${drawn.length}!`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
  }
}

export function playCardsAction(
  state: ServerGameState,
  playerId: string,
  cardIds: string[],
  chosenColor?: CardColor,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) {
    return state;
  }
  if (state.gameStatus !== 'playing') {
    throw new GameEngineError('Game is not currently active.');
  }
  if (state.pendingColorChoiceBy || state.pendingSwapBy || state.pendingChallenge) {
    throw new GameEngineError('Waiting for pending choice or challenge resolution.');
  }
  if (!cardIds || cardIds.length === 0) {
    throw new GameEngineError('Select at least one card to play.');
  }

  const hand = state.hands[playerId];
  if (!hand) {
    throw new GameEngineError('Player does not have an active hand.');
  }

  const uniqueIds = Array.from(new Set(cardIds));
  if (uniqueIds.length !== cardIds.length) {
    throw new GameEngineError('Duplicate card selection is invalid.');
  }

  const playedCards: UnoCard[] = [];
  for (const cid of uniqueIds) {
    const found = hand.find((c) => c.id === cid);
    if (!found) {
      throw new GameEngineError('Selected card is not in your hand.');
    }
    playedCards.push(found);
  }

  if (playedCards.length > 1) {
    if (!state.rules.allowMultipleIdentical) {
      throw new GameEngineError('Playing multiple identical cards is disabled.');
    }
    if (!areCardsIdenticalForMultiPlay(playedCards, state.currentSide)) {
      throw new GameEngineError('All cards in a multi-card play must be identical.');
    }
  }

  const isJumpIn = playerId !== state.currentPlayerId;
  if (isJumpIn) {
    if (!isJumpInEligible(playedCards[0], state, state.rules)) {
      throw new GameEngineError('Not your turn.');
    }
    state.currentPlayerId = playerId;
  } else {
    if (state.hasDrawnThisTurnBy === playerId && state.drawnCardPlayableId) {
      if (playedCards.length > 1 || playedCards[0].id !== state.drawnCardPlayableId) {
        throw new GameEngineError('After drawing, you may only play the drawn card or pass.');
      }
    }
    if (!isCardPlayable(playedCards[0], state, state.rules)) {
      throw new GameEngineError('That card cannot be played right now.');
    }
  }

  clearUnoVulnerabilityOnOtherTurn(state, playerId);

  const previousColor = state.currentColor;
  const remainingHand = hand.filter((c) => !uniqueIds.includes(c.id));
  const wasWild4Bluff = hadMatchingColorInHand(remainingHand, previousColor, state.currentSide);

  state.hands[playerId] = remainingHand;
  state.discardPile.push(...playedCards);
  state.hasDrawnThisTurnBy = null;
  state.drawnCardPlayableId = null;

  if (remainingHand.length === 1) {
    if (!state.calledUno[playerId]) {
      state.unoVulnerable[playerId] = true;
    }
  } else {
    state.calledUno[playerId] = false;
    state.unoVulnerable[playerId] = false;
  }

  const face = getCardFace(playedCards[0], state.currentSide);
  const count = playedCards.length;
  const active = getActivePlayers(state);
  const playerName = getPlayerName(state, playerId);

  if (isJumpIn) {
    pushActivity(state, playerId, `${playerName} Jumped In with ${face.color} ${face.value}!`, 'action');
  }

  // Check immediate win when hand empties
  if (remainingHand.length === 0) {
    // Still apply draw penalty points if needed? In UNO, round ends when player plays last card
    if (face.color !== 'wild') {
      state.currentColor = face.color;
    } else if (chosenColor && getColorsForSide(state.currentSide).includes(chosenColor)) {
      state.currentColor = chosenColor;
    }
    finalizeRoundWin(state, playerId);
    state.actionSeq += 1;
    return state;
  }

  // Handle Wild cards
  if (face.color === 'wild') {
    const validColors = getColorsForSide(state.currentSide);
    if (chosenColor && validColors.includes(chosenColor)) {
      state.currentColor = chosenColor;
      resolveWildCardAfterColor(
        state,
        playerId,
        face.value,
        count,
        previousColor,
        wasWild4Bluff
      );
      return state;
    }

    // Wait for player to pick color
    state.pendingColorChoiceBy = playerId;
    state.turnExpiresAt = computeTurnExpiry(state.rules);
    state.actionSeq += 1;
    // Store bluff info temporarily on pendingChallenge if wild4 without stack? We'll store via helper check on color choose or re-derive:
    // Actually we can store it in a clean way: check remainingHand vs previousColor right here? Wait: previousColor might be overwritten ONLY after chooseColor!
    // So previousColor is still intact in state.currentColor! Let's record it cleanly:
    if (face.value === 'wild4' && state.rules.challengeWild4 && !state.rules.stackDrawFour && !state.rules.stackDrawTwoAndFour) {
      // Save bluff evaluation in pendingChallenge? No, pendingColorChoiceBy is checked first, and state.currentColor is STILL previousColor until chooseColorAction!
      // Wait: state.hands[playerId] is already remainingHand! So chooseColorAction can evaluate wasIllegalBluff accurately against state.currentColor!
    }
    pushActivity(state, playerId, `${playerName} played ${face.value.toUpperCase()} — choosing color...`, 'action');
    return state;
  }

  // Colored card updates active color
  state.currentColor = face.color;

  if (face.value === 'reverse') {
    for (let i = 0; i < count; i++) {
      state.currentDirection = state.currentDirection === 1 ? -1 : 1;
    }
    if (active.length === 2) {
      // In 2-player UNO, Reverse acts like Skip
      const steps = count % 2 === 1 ? 2 : 1;
      pushActivity(state, playerId, `${playerName} played Reverse (${face.color})!`, 'action');
      advanceTurn(state, steps, playerId);
    } else {
      pushActivity(
        state,
        playerId,
        `${playerName} reversed direction (${state.currentDirection === 1 ? 'Clockwise' : 'Counter-Clockwise'})`,
        'action'
      );
      advanceTurn(state, 1, playerId);
    }
    return state;
  }

  if (face.value === 'skip') {
    const skippedId = getNextPlayerId(active, playerId, state.currentDirection, 1);
    pushActivity(
      state,
      playerId,
      `${playerName} skipped ${getPlayerName(state, skippedId)}!`,
      'action'
    );
    advanceTurn(state, 1 + count, playerId);
    return state;
  }

  if (face.value === 'skip_everyone') {
    pushActivity(
      state,
      playerId,
      `${playerName} played Skip Everyone and goes again!`,
      'action'
    );
    state.currentPlayerId = playerId;
    state.turnExpiresAt = computeTurnExpiry(state.rules);
    state.actionSeq += 1;
    return state;
  }

  if (face.value === 'flip') {
    let newSide = state.currentSide;
    if (count % 2 === 1) {
      newSide = flipGameSide(state);
    }
    pushActivity(
      state,
      playerId,
      `${playerName} played FLIP! Arena switched to ${newSide.toUpperCase()} SIDE!`,
      'flip'
    );
    advanceTurn(state, 1, playerId);
    return state;
  }

  if (face.value === 'draw1') {
    const nextId = getNextPlayerId(active, playerId, state.currentDirection, 1);
    const { drawn } = drawCardsFromPile(state, 1 * count);
    state.hands[nextId] = [...(state.hands[nextId] ?? []), ...drawn];
    state.calledUno[nextId] = false;
    state.unoVulnerable[nextId] = false;
    pushActivity(
      state,
      playerId,
      `${playerName} played Draw One! ${getPlayerName(state, nextId)} draws ${drawn.length}.`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
    return state;
  }

  if (face.value === 'draw5') {
    const nextId = getNextPlayerId(active, playerId, state.currentDirection, 1);
    const { drawn } = drawCardsFromPile(state, 5 * count);
    state.hands[nextId] = [...(state.hands[nextId] ?? []), ...drawn];
    state.calledUno[nextId] = false;
    state.unoVulnerable[nextId] = false;
    pushActivity(
      state,
      playerId,
      `${playerName} played Draw Five! ${getPlayerName(state, nextId)} draws ${drawn.length}.`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
    return state;
  }

  if (face.value === 'draw2') {
    const canStack =
      state.gameMode !== 'flip' &&
      (state.rules.stackDrawTwo || state.rules.stackDrawTwoAndFour);
    if (canStack) {
      state.pendingDrawCount += 2 * count;
      state.pendingDrawSource = 'draw2';
      pushActivity(
        state,
        playerId,
        `${playerName} played +${2 * count}! Stack is now +${state.pendingDrawCount}.`,
        'penalty'
      );
      advanceTurn(state, 1, playerId);
      return state;
    }

    const nextId = getNextPlayerId(active, playerId, state.currentDirection, 1);
    const { drawn } = drawCardsFromPile(state, 2 * count);
    state.hands[nextId] = [...(state.hands[nextId] ?? []), ...drawn];
    state.calledUno[nextId] = false;
    state.unoVulnerable[nextId] = false;
    pushActivity(
      state,
      playerId,
      `${playerName} played Draw Two! ${getPlayerName(state, nextId)} draws ${drawn.length}.`,
      'penalty'
    );
    advanceTurn(state, 2, playerId);
    return state;
  }

  // Seven-O / Zero-Seven custom rules
  const sevenZeroActive = state.rules.sevenORule || state.rules.zeroSevenRule;
  if (sevenZeroActive && face.value === '7') {
    if (active.length === 2) {
      const other = active.find((p) => p.id !== playerId)!;
      const tmp = state.hands[playerId];
      state.hands[playerId] = state.hands[other.id];
      state.hands[other.id] = tmp;
      state.calledUno[playerId] = state.hands[playerId].length === 1;
      state.calledUno[other.id] = state.hands[other.id].length === 1;
      state.unoVulnerable[playerId] = false;
      state.unoVulnerable[other.id] = false;
      pushActivity(
        state,
        playerId,
        `${playerName} played 7 and swapped hands with ${other.username}!`,
        'action'
      );
      advanceTurn(state, 1, playerId);
      return state;
    }

    state.pendingSwapBy = playerId;
    state.turnExpiresAt = computeTurnExpiry(state.rules);
    state.actionSeq += 1;
    pushActivity(state, playerId, `${playerName} played 7 — choosing a player to swap hands with...`, 'action');
    return state;
  }

  if (sevenZeroActive && face.value === '0') {
    // Rotate all hands in currentDirection
    const snapshot = active.map((p) => state.hands[p.id] ?? []);
    for (let i = 0; i < active.length; i++) {
      const targetIdx =
        state.currentDirection === 1
          ? (i + 1) % active.length
          : (i - 1 + active.length) % active.length;
      const targetId = active[targetIdx].id;
      state.hands[targetId] = snapshot[i];
      state.calledUno[targetId] = state.hands[targetId].length === 1;
      state.unoVulnerable[targetId] = false;
    }
    pushActivity(
      state,
      playerId,
      `${playerName} played 0! All hands rotated ${state.currentDirection === 1 ? 'clockwise' : 'counter-clockwise'}!`,
      'action'
    );
    advanceTurn(state, 1, playerId);
    return state;
  }

  // Standard number card
  pushActivity(
    state,
    playerId,
    `${playerName} played ${count > 1 ? `${count}x ` : ''}${face.color.toUpperCase()} ${face.value}`,
    'neutral'
  );
  advanceTurn(state, 1, playerId);
  return state;
}

export function chooseColorAction(
  state: ServerGameState,
  playerId: string,
  color: CardColor,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing' || state.pendingColorChoiceBy !== playerId) {
    throw new GameEngineError('No pending color choice for this player.');
  }

  const validColors = getColorsForSide(state.currentSide);
  if (!validColors.includes(color)) {
    throw new GameEngineError('Invalid color for current side.');
  }

  const previousColor = state.currentColor;
  const topCard = state.discardPile[state.discardPile.length - 1];
  const topFace = getCardFace(topCard, state.currentSide);
  let count = 1;
  for (let i = state.discardPile.length - 2; i >= 0; i--) {
    const f = getCardFace(state.discardPile[i], state.currentSide);
    if (f.value === topFace.value && f.color === topFace.color && state.rules.allowMultipleIdentical) {
      // Only count cards played in same turn? Safe fallback: count is 1 unless tracked; 1 is standard.
      break;
    }
    break;
  }

  const wasIllegalBluff = hadMatchingColorInHand(
    state.hands[playerId] ?? [],
    previousColor,
    state.currentSide
  );

  state.pendingColorChoiceBy = null;
  state.currentColor = color;
  resolveWildCardAfterColor(state, playerId, topFace.value, count, previousColor, wasIllegalBluff);
  return state;
}

export function swapHandsAction(
  state: ServerGameState,
  playerId: string,
  targetPlayerId: string,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing' || state.pendingSwapBy !== playerId) {
    throw new GameEngineError('No pending hand swap for this player.');
  }
  const active = getActivePlayers(state);
  const target = active.find((p) => p.id === targetPlayerId && p.id !== playerId);
  if (!target) {
    throw new GameEngineError('Invalid swap target.');
  }

  const mine = state.hands[playerId] ?? [];
  const theirs = state.hands[targetPlayerId] ?? [];
  state.hands[playerId] = theirs;
  state.hands[targetPlayerId] = mine;
  state.calledUno[playerId] = state.hands[playerId].length === 1;
  state.calledUno[targetPlayerId] = state.hands[targetPlayerId].length === 1;
  state.unoVulnerable[playerId] = false;
  state.unoVulnerable[targetPlayerId] = false;
  state.pendingSwapBy = null;

  pushActivity(
    state,
    playerId,
    `${getPlayerName(state, playerId)} swapped hands with ${target.username}!`,
    'action'
  );
  advanceTurn(state, 1, playerId);
  return state;
}

export function challengeWild4Action(
  state: ServerGameState,
  playerId: string,
  challenge: boolean,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (
    state.gameStatus !== 'playing' ||
    !state.pendingChallenge ||
    state.pendingChallenge.challengerId !== playerId
  ) {
    throw new GameEngineError('No pending Wild Draw Four challenge for you.');
  }

  const { offenderId, challengerId, wasIllegalBluff, drawCount } = state.pendingChallenge;
  state.pendingChallenge = null;

  if (!challenge) {
    const { drawn } = drawCardsFromPile(state, drawCount);
    state.hands[challengerId] = [...(state.hands[challengerId] ?? []), ...drawn];
    state.calledUno[challengerId] = false;
    state.unoVulnerable[challengerId] = false;
    pushActivity(
      state,
      challengerId,
      `${getPlayerName(state, challengerId)} accepted +${drawn.length} cards.`,
      'penalty'
    );
    advanceTurn(state, 1, challengerId);
    return state;
  }

  if (wasIllegalBluff) {
    const { drawn } = drawCardsFromPile(state, drawCount);
    state.hands[offenderId] = [...(state.hands[offenderId] ?? []), ...drawn];
    state.calledUno[offenderId] = false;
    state.unoVulnerable[offenderId] = false;
    state.currentPlayerId = challengerId;
    state.turnExpiresAt = computeTurnExpiry(state.rules);
    state.actionSeq += 1;
    pushActivity(
      state,
      challengerId,
      `Challenge WON! ${getPlayerName(state, offenderId)} bluffed and draws ${drawn.length} cards!`,
      'uno'
    );
    return state;
  }

  // Bluff challenge failed: challenger draws drawCount + 2 and loses turn
  const { drawn } = drawCardsFromPile(state, drawCount + 2);
  state.hands[challengerId] = [...(state.hands[challengerId] ?? []), ...drawn];
  state.calledUno[challengerId] = false;
  state.unoVulnerable[challengerId] = false;
  pushActivity(
    state,
    challengerId,
    `Challenge FAILED! ${getPlayerName(state, challengerId)} draws ${drawn.length} cards!`,
    'penalty'
  );
  advanceTurn(state, 1, challengerId);
  return state;
}

export function drawCardAction(
  state: ServerGameState,
  playerId: string,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing') {
    throw new GameEngineError('Game is not currently active.');
  }
  if (state.currentPlayerId !== playerId) {
    throw new GameEngineError('Wait for your turn to draw.');
  }
  if (state.pendingColorChoiceBy || state.pendingSwapBy || state.pendingChallenge) {
    throw new GameEngineError('Resolve the pending action first.');
  }
  if (state.hasDrawnThisTurnBy === playerId) {
    throw new GameEngineError('You already drew a card this turn.');
  }

  clearUnoVulnerabilityOnOtherTurn(state, playerId);

  // Accept pending draw stack
  if (state.pendingDrawCount > 0) {
    const { drawn } = drawCardsFromPile(state, state.pendingDrawCount);
    state.hands[playerId] = [...(state.hands[playerId] ?? []), ...drawn];
    state.calledUno[playerId] = false;
    state.unoVulnerable[playerId] = false;
    state.pendingDrawCount = 0;
    state.pendingDrawSource = null;
    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} drew ${drawn.length} penalty cards.`,
      'penalty'
    );
    advanceTurn(state, 1, playerId);
    return state;
  }

  // Draw until playable
  if (state.rules.drawUntilPlayable) {
    const drawnAll: UnoCard[] = [];
    let playableCard: UnoCard | null = null;
    for (let i = 0; i < 40; i++) {
      const { drawn } = drawCardsFromPile(state, 1);
      if (drawn.length === 0) break;
      const card = drawn[0];
      drawnAll.push(card);
      if (isCardPlayable(card, state, state.rules)) {
        playableCard = card;
        break;
      }
    }
    state.hands[playerId] = [...(state.hands[playerId] ?? []), ...drawnAll];
    state.calledUno[playerId] = false;
    state.unoVulnerable[playerId] = false;

    if (playableCard) {
      if (state.rules.forcePlayAfterDraw) {
        const face = getCardFace(playableCard, state.currentSide);
        if (face.color !== 'wild') {
          pushActivity(
            state,
            playerId,
            `${getPlayerName(state, playerId)} drew ${drawnAll.length} card(s) and auto-played the playable card!`,
            'action'
          );
          return playCardsAction(state, playerId, [playableCard.id]);
        }
      }
      state.hasDrawnThisTurnBy = playerId;
      state.drawnCardPlayableId = playableCard.id;
      state.turnExpiresAt = computeTurnExpiry(state.rules);
      state.actionSeq += 1;
      pushActivity(
        state,
        playerId,
        `${getPlayerName(state, playerId)} drew ${drawnAll.length} card(s) and found a playable card.`,
        'neutral'
      );
      return state;
    }

    pushActivity(
      state,
      playerId,
      `${getPlayerName(state, playerId)} drew ${drawnAll.length} card(s) (no playable cards left).`,
      'neutral'
    );
    advanceTurn(state, 1, playerId);
    return state;
  }

  // Standard draw 1
  const { drawn } = drawCardsFromPile(state, 1);
  if (drawn.length === 0) {
    pushActivity(state, playerId, `Deck empty — ${getPlayerName(state, playerId)} passes turn.`, 'neutral');
    advanceTurn(state, 1, playerId);
    return state;
  }

  const card = drawn[0];
  state.hands[playerId] = [...(state.hands[playerId] ?? []), card];
  state.calledUno[playerId] = false;
  state.unoVulnerable[playerId] = false;

  if (isCardPlayable(card, state, state.rules)) {
    if (state.rules.forcePlayAfterDraw) {
      const face = getCardFace(card, state.currentSide);
      if (face.color !== 'wild') {
        pushActivity(
          state,
          playerId,
          `${getPlayerName(state, playerId)} drew a playable card and must play it!`,
          'action'
        );
        return playCardsAction(state, playerId, [card.id]);
      }
    }
    state.hasDrawnThisTurnBy = playerId;
    state.drawnCardPlayableId = card.id;
    state.turnExpiresAt = computeTurnExpiry(state.rules);
    state.actionSeq += 1;
    pushActivity(state, playerId, `${getPlayerName(state, playerId)} drew 1 card.`, 'neutral');
    return state;
  }

  pushActivity(state, playerId, `${getPlayerName(state, playerId)} drew 1 card and passed.`, 'neutral');
  advanceTurn(state, 1, playerId);
  return state;
}

export function passTurnAction(
  state: ServerGameState,
  playerId: string,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing' || state.currentPlayerId !== playerId) {
    throw new GameEngineError('Not your turn.');
  }
  if (state.hasDrawnThisTurnBy !== playerId) {
    throw new GameEngineError('Draw a card before passing.');
  }
  if (state.rules.forcePlayAfterDraw) {
    throw new GameEngineError('Force play after draw is enabled — you must play the drawn card.');
  }
  pushActivity(state, playerId, `${getPlayerName(state, playerId)} kept the drawn card and passed.`, 'neutral');
  advanceTurn(state, 1, playerId);
  return state;
}

export function callUnoAction(
  state: ServerGameState,
  playerId: string,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing') {
    throw new GameEngineError('Game is not active.');
  }
  const hand = state.hands[playerId];
  if (!hand || hand.length > 2) {
    throw new GameEngineError('You can only call UNO when you have 1 or 2 cards.');
  }
  state.calledUno[playerId] = true;
  state.unoVulnerable[playerId] = false;
  state.actionSeq += 1;
  pushActivity(state, playerId, `${getPlayerName(state, playerId)} shouted UNO!`, 'uno');
  return state;
}

export function catchUnoAction(
  state: ServerGameState,
  catcherId: string,
  targetPlayerId: string,
  actionId?: string
): ServerGameState {
  if (markActionProcessed(state, actionId)) return state;
  if (state.gameStatus !== 'playing') {
    throw new GameEngineError('Game is not active.');
  }
  if (catcherId === targetPlayerId) {
    throw new GameEngineError('You cannot catch yourself.');
  }
  const targetHand = state.hands[targetPlayerId];
  if (!targetHand || targetHand.length !== 1 || !state.unoVulnerable[targetPlayerId]) {
    throw new GameEngineError('That player is not vulnerable to an UNO penalty.');
  }

  const penalty = state.rules.unoPenaltyCount;
  const { drawn } = drawCardsFromPile(state, penalty);
  state.hands[targetPlayerId] = [...targetHand, ...drawn];
  state.unoVulnerable[targetPlayerId] = false;
  state.calledUno[targetPlayerId] = false;
  state.actionSeq += 1;
  pushActivity(
    state,
    catcherId,
    `${getPlayerName(state, catcherId)} caught ${getPlayerName(state, targetPlayerId)} without UNO! (+${drawn.length} penalty)`,
    'penalty'
  );
  return state;
}

export function handleTurnTimeout(state: ServerGameState): ServerGameState {
  if (state.gameStatus !== 'playing') return state;

  if (state.pendingColorChoiceBy) {
    const palette = getColorsForSide(state.currentSide);
    return chooseColorAction(state, state.pendingColorChoiceBy, palette[0]);
  }
  if (state.pendingSwapBy) {
    const active = getActivePlayers(state);
    const other = active.find((p) => p.id !== state.pendingSwapBy);
    if (other) {
      return swapHandsAction(state, state.pendingSwapBy, other.id);
    }
  }
  if (state.pendingChallenge) {
    return challengeWild4Action(state, state.pendingChallenge.challengerId, false);
  }
  if (state.hasDrawnThisTurnBy) {
    const pid = state.hasDrawnThisTurnBy;
    if (state.rules.forcePlayAfterDraw && state.drawnCardPlayableId) {
      const card = state.hands[pid]?.find((c) => c.id === state.drawnCardPlayableId);
      if (card) {
        const palette = getColorsForSide(state.currentSide);
        return playCardsAction(state, pid, [card.id], palette[0]);
      }
    }
    state.hasDrawnThisTurnBy = null;
    state.drawnCardPlayableId = null;
    pushActivity(state, pid, `${getPlayerName(state, pid)} timed out and passed.`, 'neutral');
    advanceTurn(state, 1, pid);
    return state;
  }

  const pid = state.currentPlayerId;
  pushActivity(state, pid, `${getPlayerName(state, pid)} ran out of time!`, 'penalty');
  const nextState = drawCardAction(state, pid);
  // If they drew a playable card right on timeout, auto-advance so game never stalls
  if (nextState.hasDrawnThisTurnBy === pid) {
    nextState.hasDrawnThisTurnBy = null;
    nextState.drawnCardPlayableId = null;
    advanceTurn(nextState, 1, pid);
  }
  return nextState;
}

export function startNextRoundAction(state: ServerGameState): ServerGameState {
  if (state.gameStatus !== 'round_over') {
    throw new GameEngineError('Current round is not over.');
  }
  return createInitialGameState(
    state.roomId,
    state.gameMode,
    state.rules,
    state.players,
    state.roundNumber + 1,
    state.scores
  );
}

export function toPublicGameState(state: ServerGameState): PublicGameState {
  const publicPlayers: PublicPlayerState[] = state.players.map((p) => ({
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    isHost: p.isHost,
    isReady: p.isReady,
    isSpectator: Boolean(p.isSpectator),
    cardCount: (state.hands[p.id] ?? []).length,
    score: state.scores[p.id] ?? 0,
    calledUno: Boolean(state.calledUno[p.id]),
    unoVulnerable: Boolean(state.unoVulnerable[p.id]),
    connectionStatus: p.connectionStatus,
  }));

  return {
    roomId: state.roomId,
    gameMode: state.gameMode,
    rules: state.rules,
    gameStatus: state.gameStatus,
    roundNumber: state.roundNumber,
    currentPlayerId: state.currentPlayerId,
    currentDirection: state.currentDirection,
    currentColor: state.currentColor,
    currentSide: state.currentSide,
    discardTopCard: state.discardPile[state.discardPile.length - 1] ?? null,
    discardCount: state.discardPile.length,
    drawPileCount: state.drawPile.length,
    pendingDrawCount: state.pendingDrawCount,
    pendingDrawSource: state.pendingDrawSource,
    pendingColorChoiceBy: state.pendingColorChoiceBy,
    pendingSwapBy: state.pendingSwapBy,
    pendingChallenge: state.pendingChallenge
      ? {
          offenderId: state.pendingChallenge.offenderId,
          challengerId: state.pendingChallenge.challengerId,
          previousColor: state.pendingChallenge.previousColor,
          drawCount: state.pendingChallenge.drawCount,
        }
      : null,
    hasDrawnThisTurnBy: state.hasDrawnThisTurnBy,
    drawnCardPlayableId: state.drawnCardPlayableId,
    turnExpiresAt: state.turnExpiresAt,
    players: publicPlayers,
    winnerId: state.winnerId,
    roundWinnerId: state.roundWinnerId,
    roundStandings: state.roundStandings,
    lastAction: state.lastAction,
    activityLog: state.activityLog,
    actionSeq: state.actionSeq,
  };
}
