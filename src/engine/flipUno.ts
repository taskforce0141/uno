import { DARK_COLORS, DEFAULT_CUSTOM_RULES, LIGHT_COLORS } from './gameTypes.ts';
import type {
  CardColor,
  CustomRulesConfig,
  FlipSide,
  ServerGameState,
} from './gameTypes.ts';
import { getCardFace } from './validation.ts';

export const FLIP_RULES: CustomRulesConfig = {
  ...DEFAULT_CUSTOM_RULES,
  startingHandSize: 7,
  turnTimerSeconds: 30,
  stackDrawTwo: false,
  stackDrawFour: false,
  stackDrawTwoAndFour: false,
  drawUntilPlayable: false,
  jumpIn: false,
  forcePlayAfterDraw: false,
  allowMultipleIdentical: false,
  sevenORule: false,
  zeroSevenRule: false,
  challengeWild4: false,
  unoPenaltyCount: 2,
  firstPlayerToWin: true,
  scoreBasedGame: false,
  targetScore: 500,
};

export function flipGameSide(state: ServerGameState): FlipSide {
  const nextSide: FlipSide = state.currentSide === 'light' ? 'dark' : 'light';
  state.currentSide = nextSide;

  const topCard = state.discardPile[state.discardPile.length - 1];
  if (topCard) {
    const nextTopFace = getCardFace(topCard, nextSide);
    if (nextTopFace.color === 'wild') {
      const palette: CardColor[] = nextSide === 'light' ? [...LIGHT_COLORS] : [...DARK_COLORS];
      state.currentColor = palette[Math.floor(Math.random() * palette.length)];
    } else {
      state.currentColor = nextTopFace.color;
    }
  } else {
    state.currentColor = nextSide === 'light' ? 'red' : 'pink';
  }

  return nextSide;
}

export function getColorsForSide(side: FlipSide): CardColor[] {
  return side === 'light' ? [...LIGHT_COLORS] : [...DARK_COLORS];
}

export function getFlipModeDescription(): string[] {
  return [
    'Dual-sided 112-card deck: Light Side & Dark Side',
    'Light Side: Draw One, Skip, Reverse, Flip, Wild +2',
    'Dark Side: Pink, Teal, Orange, Purple · Draw Five, Skip Everyone, Wild Draw Color',
    'Playing Flip switches all hands, draw pile, and discard pile',
  ];
}
