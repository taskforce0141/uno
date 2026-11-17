import {
  CardFace,
  CustomRulesConfig,
  FlipSide,
  ServerGameState,
  UnoCard,
} from './gameTypes.ts';

export function getCardFace(card: UnoCard, side: FlipSide): CardFace {
  if (side === 'dark' && card.dark) {
    return card.dark;
  }
  return card.light;
}

export function isDrawValue(value: string): boolean {
  return (
    value === 'draw1' ||
    value === 'draw2' ||
    value === 'wild2' ||
    value === 'wild4' ||
    value === 'draw5' ||
    value === 'wild_draw_color'
  );
}

export function isCardPlayable(
  card: UnoCard,
  state: ServerGameState,
  rules: CustomRulesConfig
): boolean {
  if (state.gameStatus !== 'playing') return false;
  if (state.pendingColorChoiceBy || state.pendingSwapBy || state.pendingChallenge) {
    return false;
  }

  const face = getCardFace(card, state.currentSide);
  const topCard = state.discardPile[state.discardPile.length - 1];
  if (!topCard) return true;
  const topFace = getCardFace(topCard, state.currentSide);

  // When a draw penalty stack is active, only stackable draw cards can be played
  if (state.pendingDrawCount > 0 && state.pendingDrawSource) {
    if (state.gameMode === 'flip') {
      // In Flip, Draw 1 / Wild +2 / Draw 5 / Wild Draw Color are not stacked unless custom rules enabled
      if (state.pendingDrawSource === 'draw2' && rules.stackDrawTwo && face.value === 'draw2') return true;
      return false;
    }

    if (state.pendingDrawSource === 'draw2') {
      if (rules.stackDrawTwo && face.value === 'draw2') return true;
      if (rules.stackDrawTwoAndFour && face.value === 'wild4') return true;
      return false;
    }

    if (state.pendingDrawSource === 'wild4') {
      if (rules.stackDrawFour && face.value === 'wild4') return true;
      if (rules.stackDrawTwoAndFour && face.value === 'draw2') return true;
      return false;
    }

    return false;
  }

  // Wild cards are always playable when no draw stack is pending
  if (face.color === 'wild') {
    return true;
  }

  // Match active color
  if (face.color === state.currentColor) {
    return true;
  }

  // Match top card symbol/number
  if (face.value === topFace.value) {
    return true;
  }

  return false;
}

export function isJumpInEligible(
  card: UnoCard,
  state: ServerGameState,
  rules: CustomRulesConfig
): boolean {
  if (!rules.jumpIn) return false;
  if (state.gameStatus !== 'playing') return false;
  if (state.pendingDrawCount > 0) return false;
  if (state.pendingColorChoiceBy || state.pendingSwapBy || state.pendingChallenge) return false;

  const topCard = state.discardPile[state.discardPile.length - 1];
  if (!topCard) return false;

  const face = getCardFace(card, state.currentSide);
  const topFace = getCardFace(topCard, state.currentSide);

  if (face.color === 'wild' || topFace.color === 'wild') {
    return false;
  }

  return face.color === topFace.color && face.value === topFace.value;
}

export function areCardsIdenticalForMultiPlay(
  cards: UnoCard[],
  side: FlipSide
): boolean {
  if (cards.length <= 1) return true;
  const first = getCardFace(cards[0], side);
  return cards.every((c) => {
    const f = getCardFace(c, side);
    return f.color === first.color && f.value === first.value;
  });
}

export function hadMatchingColorInHand(
  remainingHand: UnoCard[],
  previousColor: string,
  side: FlipSide
): boolean {
  return remainingHand.some((c) => {
    const face = getCardFace(c, side);
    return face.color === previousColor;
  });
}

export function getCardPointValue(card: UnoCard, side: FlipSide): number {
  const face = getCardFace(card, side);
  switch (face.value) {
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      return Number(face.value);
    case 'draw1':
      return 10;
    case 'skip':
    case 'reverse':
    case 'draw2':
    case 'flip':
    case 'draw5':
      return 20;
    case 'skip_everyone':
      return 30;
    case 'wild':
    case 'wild2':
      return 40;
    case 'wild4':
    case 'wild_draw_color':
      return 50;
    default:
      return 10;
  }
}

export function calculateHandPoints(hand: UnoCard[], side: FlipSide): number {
  return hand.reduce((sum, card) => sum + getCardPointValue(card, side), 0);
}
