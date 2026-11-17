// Standalone server-side engine helpers for Firebase Cloud Functions
// Mirrors src/engine/* so functions/ compiles independently during firebase deploy.

export type GameMode = 'classic' | 'flip' | 'custom';
export type FlipSide = 'light' | 'dark';
export type CardColor = 'red' | 'blue' | 'green' | 'yellow' | 'pink' | 'teal' | 'orange' | 'purple';

export interface CardFace {
  color: CardColor | 'wild';
  value: string;
}

export interface UnoCard {
  id: string;
  light: CardFace;
  dark?: CardFace;
}

export interface CustomRulesConfig {
  startingHandSize: 5 | 6 | 7 | 8 | 10;
  turnTimerSeconds: 15 | 30 | 45 | 60 | 0;
  stackDrawTwo: boolean;
  stackDrawFour: boolean;
  stackDrawTwoAndFour: boolean;
  drawUntilPlayable: boolean;
  jumpIn: boolean;
  forcePlayAfterDraw: boolean;
  allowMultipleIdentical: boolean;
  sevenORule: boolean;
  zeroSevenRule: boolean;
  challengeWild4: boolean;
  unoPenaltyCount: 2 | 4;
  firstPlayerToWin: boolean;
  scoreBasedGame: boolean;
  targetScore: 200 | 300 | 500;
  allowSpectators: boolean;
  allowLateJoining: boolean;
}

export const LIGHT_COLORS: CardColor[] = ['red', 'blue', 'green', 'yellow'];
export const DARK_COLORS: CardColor[] = ['pink', 'teal', 'orange', 'purple'];

export function shuffleCards<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createDeckForMode(mode: GameMode): UnoCard[] {
  let seq = 1;
  if (mode === 'flip') {
    const lightFaces: CardFace[] = [];
    const darkFaces: CardFace[] = [];
    for (const c of LIGHT_COLORS) {
      for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'draw1', 'skip', 'reverse', 'flip']) {
        lightFaces.push({ color: c, value: v }, { color: c, value: v });
      }
    }
    for (let i = 0; i < 4; i++) {
      lightFaces.push({ color: 'wild', value: 'wild' }, { color: 'wild', value: 'wild2' });
    }
    for (const c of DARK_COLORS) {
      for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'draw5', 'skip_everyone', 'reverse', 'flip']) {
        darkFaces.push({ color: c, value: v }, { color: c, value: v });
      }
    }
    for (let i = 0; i < 4; i++) {
      darkFaces.push({ color: 'wild', value: 'wild' }, { color: 'wild', value: 'wild_draw_color' });
    }
    const sl = shuffleCards(lightFaces);
    const sd = shuffleCards(darkFaces);
    return shuffleCards(sl.map((light, i) => ({ id: `f_${seq++}`, light, dark: sd[i] })));
  }

  const deck: UnoCard[] = [];
  for (const c of LIGHT_COLORS) {
    deck.push({ id: `c_${seq++}`, light: { color: c, value: '0' } });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) {
      deck.push({ id: `c_${seq++}`, light: { color: c, value: v } });
      deck.push({ id: `c_${seq++}`, light: { color: c, value: v } });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c_${seq++}`, light: { color: 'wild', value: 'wild' } });
    deck.push({ id: `c_${seq++}`, light: { color: 'wild', value: 'wild4' } });
  }
  return shuffleCards(deck);
}

export function getCardFace(card: UnoCard, side: FlipSide): CardFace {
  return side === 'dark' && card.dark ? card.dark : card.light;
}
