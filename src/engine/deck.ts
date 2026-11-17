import { DARK_COLORS, LIGHT_COLORS } from './gameTypes.ts';
import type {
  CardFace,
  ClassicCardValue,
  FlipDarkValue,
  FlipLightValue,
  ServerGameState,
  UnoCard,
} from './gameTypes.ts';

export function shuffleCards<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createClassicDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let seq = 1;

  for (const color of LIGHT_COLORS) {
    // One 0 per color
    deck.push({ id: `c_${seq++}`, light: { color, value: '0' } });

    // Two each of 1-9 and action cards
    const pairedValues: ClassicCardValue[] = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'skip',
      'reverse',
      'draw2',
    ];
    for (const value of pairedValues) {
      deck.push({ id: `c_${seq++}`, light: { color, value } });
      deck.push({ id: `c_${seq++}`, light: { color, value } });
    }
  }

  // 4 Wild, 4 Wild Draw Four
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c_${seq++}`, light: { color: 'wild', value: 'wild' } });
    deck.push({ id: `c_${seq++}`, light: { color: 'wild', value: 'wild4' } });
  }

  return shuffleCards(deck);
}

export function createFlipDeck(): UnoCard[] {
  const lightFaces: CardFace[] = [];
  const darkFaces: CardFace[] = [];

  for (const color of LIGHT_COLORS) {
    const lightValues: FlipLightValue[] = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'draw1',
      'skip',
      'reverse',
      'flip',
    ];
    for (const value of lightValues) {
      lightFaces.push({ color, value });
      lightFaces.push({ color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    lightFaces.push({ color: 'wild', value: 'wild' });
    lightFaces.push({ color: 'wild', value: 'wild2' });
  }

  for (const color of DARK_COLORS) {
    const darkValues: FlipDarkValue[] = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'draw5',
      'skip_everyone',
      'reverse',
      'flip',
    ];
    for (const value of darkValues) {
      darkFaces.push({ color, value });
      darkFaces.push({ color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    darkFaces.push({ color: 'wild', value: 'wild' });
    darkFaces.push({ color: 'wild', value: 'wild_draw_color' });
  }

  const shuffledLight = shuffleCards(lightFaces);
  const shuffledDark = shuffleCards(darkFaces);

  const deck: UnoCard[] = shuffledLight.map((light, idx) => ({
    id: `f_${idx + 1}`,
    light,
    dark: shuffledDark[idx],
  }));

  return shuffleCards(deck);
}

export function drawCardsFromPile(
  state: ServerGameState,
  count: number
): { drawn: UnoCard[]; reshuffled: boolean } {
  const drawn: UnoCard[] = [];
  let reshuffled = false;

  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length <= 1) {
        break;
      }
      const top = state.discardPile[state.discardPile.length - 1];
      const recyclable = state.discardPile.slice(0, -1);
      state.drawPile = shuffleCards(recyclable);
      state.discardPile = [top];
      reshuffled = true;
    }
    const next = state.drawPile.pop();
    if (next) {
      drawn.push(next);
    }
  }

  return { drawn, reshuffled };
}
