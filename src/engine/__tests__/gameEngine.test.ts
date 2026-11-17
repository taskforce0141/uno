import { describe, it, expect } from 'vitest';
import { createClassicDeck, createFlipDeck } from '../deck.ts';
import {
  callUnoAction,
  catchUnoAction,
  challengeWild4Action,
  chooseColorAction,
  createInitialGameState,
  drawCardAction,
  playCardsAction,
  swapHandsAction,
} from '../gameEngine.ts';
import { PlayerRecord, ServerGameState, UnoCard } from '../gameTypes.ts';

function makePlayers(count: number): PlayerRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    username: `Player ${i + 1}`,
    avatar: 'crimson',
    isHost: i === 0,
    isReady: true,
    connectionStatus: 'online',
    joinedAt: 1000 + i,
    lastSeen: 1000 + i,
  }));
}

function card(id: string, color: any, value: any, darkColor?: any, darkValue?: any): UnoCard {
  return {
    id,
    light: { color, value },
    ...(darkColor ? { dark: { color: darkColor, value: darkValue } } : {}),
  };
}

describe('Deck Generation', () => {
  it('generates standard 108-card Classic UNO deck', () => {
    const deck = createClassicDeck();
    expect(deck.length).toBe(108);
    expect(deck.filter((c) => c.light.value === 'wild').length).toBe(4);
    expect(deck.filter((c) => c.light.value === 'wild4').length).toBe(4);
  });

  it('generates 112-card dual-sided UNO Flip deck', () => {
    const deck = createFlipDeck();
    expect(deck.length).toBe(112);
    expect(deck.every((c) => c.light && c.dark)).toBe(true);
    expect(deck.filter((c) => c.light.value === 'flip').length).toBe(8);
    expect(deck.filter((c) => c.dark?.value === 'flip').length).toBe(8);
  });
});

describe('Classic UNO Mechanics', () => {
  it('handles 2-player Reverse as Skip', () => {
    const state = createInitialGameState('r1', 'classic', undefined, makePlayers(2));
    const rev = card('rev1', 'red', 'reverse');
    state.currentColor = 'red';
    state.discardPile = [card('top', 'red', '5')];
    state.hands.p1 = [rev, card('keep', 'blue', '1')];

    playCardsAction(state, 'p1', ['rev1']);
    expect(state.currentPlayerId).toBe('p1');
  });

  it('enforces UNO call and Catch penalty', () => {
    const state = createInitialGameState('r1', 'classic', undefined, makePlayers(3));
    state.currentColor = 'green';
    state.discardPile = [card('top', 'green', '4')];
    state.hands.p1 = [card('g9', 'green', '9'), card('g2', 'green', '2')];

    playCardsAction(state, 'p1', ['g9']);
    expect(state.hands.p1.length).toBe(1);
    expect(state.unoVulnerable.p1).toBe(true);

    catchUnoAction(state, 'p2', 'p1');
    expect(state.hands.p1.length).toBe(3); // +2 penalty
    expect(state.unoVulnerable.p1).toBe(false);

    // Calling UNO protects player
    state.currentPlayerId = 'p2';
    state.hands.p2 = [card('g3', 'green', '3'), card('g7', 'green', '7')];
    callUnoAction(state, 'p2');
    playCardsAction(state, 'p2', ['g3']);
    expect(state.unoVulnerable.p2).toBe(false);
  });
});

describe('UNO Flip Mechanics', () => {
  it('flips entire game to Dark Side and executes Skip Everyone & Draw Five', () => {
    const state = createInitialGameState('r1', 'flip', undefined, makePlayers(3));
    state.currentColor = 'blue';
    state.discardPile = [card('top', 'blue', '3', 'purple', '3')];
    const flipCard = card('fl1', 'blue', 'flip', 'teal', 'flip');
    const skipAll = card('se1', 'yellow', '1', 'teal', 'skip_everyone');
    const draw5 = card('d5', 'red', '2', 'teal', 'draw5');
    state.hands.p1 = [flipCard, card('x', 'red', '1', 'pink', '1')];
    state.hands.p2 = [skipAll, draw5, card('y', 'green', '4', 'teal', '8')];

    playCardsAction(state, 'p1', ['fl1']);
    expect(state.currentSide).toBe('dark');
    expect(state.currentColor).toBe('teal');
    expect(state.currentPlayerId).toBe('p2');

    // p2 plays Skip Everyone -> stays p2's turn
    playCardsAction(state, 'p2', ['se1']);
    expect(state.currentPlayerId).toBe('p2');

    // p2 plays Draw Five -> p3 draws 5 and is skipped -> p1's turn
    const p3Before = state.hands.p3.length;
    playCardsAction(state, 'p2', ['d5']);
    expect(state.hands.p3.length).toBe(p3Before + 5);
    expect(state.currentPlayerId).toBe('p1');
  });
});

describe('Custom UNO Rules', () => {
  it('stacks Draw Two and Wild Draw Four when configured', () => {
    const state: ServerGameState = createInitialGameState(
      'r1',
      'custom',
      { stackDrawTwo: true, stackDrawFour: true, stackDrawTwoAndFour: true },
      makePlayers(3)
    );
    state.currentColor = 'red';
    state.discardPile = [card('top', 'red', '2')];
    state.hands.p1 = [card('d2_1', 'red', 'draw2'), card('k1', 'blue', '1')];
    state.hands.p2 = [card('w4_1', 'wild', 'wild4'), card('k2', 'green', '1')];
    const p3Before = state.hands.p3.length;

    playCardsAction(state, 'p1', ['d2_1']);
    expect(state.pendingDrawCount).toBe(2);
    expect(state.currentPlayerId).toBe('p2');

    playCardsAction(state, 'p2', ['w4_1'], 'yellow');
    expect(state.pendingDrawCount).toBe(6);
    expect(state.currentColor).toBe('yellow');
    expect(state.currentPlayerId).toBe('p3');

    drawCardAction(state, 'p3');
    expect(state.hands.p3.length).toBe(p3Before + 6);
    expect(state.pendingDrawCount).toBe(0);
    expect(state.currentPlayerId).toBe('p1');
  });

  it('supports Jump-In out of turn with exact matching card', () => {
    const state = createInitialGameState('r1', 'custom', { jumpIn: true }, makePlayers(3));
    state.currentColor = 'green';
    state.discardPile = [card('top', 'green', '6')];
    state.currentPlayerId = 'p1';
    state.hands.p3 = [card('ji', 'green', '6'), card('k3', 'red', '1')];

    playCardsAction(state, 'p3', ['ji']);
    expect(state.currentPlayerId).toBe('p1'); // p3 jumped in and next after p3 is p1
    expect(state.discardPile[state.discardPile.length - 1].id).toBe('ji');
  });

  it('supports Seven-O hand swap and hand rotation', () => {
    const state = createInitialGameState('r1', 'custom', { sevenORule: true }, makePlayers(3));
    state.currentColor = 'blue';
    state.discardPile = [card('top', 'blue', '1')];
    const seven = card('b7', 'blue', '7');
    const zero = card('b0', 'blue', '0');
    state.hands.p1 = [seven, card('p1_only', 'red', '9')];
    state.hands.p2 = [zero, card('p2_a', 'yellow', '3'), card('p2_b', 'green', '4')];
    state.hands.p3 = [card('p3_a', 'red', '5')];

    playCardsAction(state, 'p1', ['b7']);
    expect(state.pendingSwapBy).toBe('p1');

    swapHandsAction(state, 'p1', 'p3');
    expect(state.hands.p1.map((c) => c.id)).toEqual(['p3_a']);
    expect(state.hands.p3.map((c) => c.id)).toEqual(['p1_only']);
    expect(state.currentPlayerId).toBe('p2');

    // p2 plays 0 -> hands rotate clockwise (p1 -> p2, p2 -> p3, p3 -> p1)
    playCardsAction(state, 'p2', ['b0']);
    expect(state.hands.p2.map((c) => c.id)).toEqual(['p3_a']);
    expect(state.hands.p1.map((c) => c.id)).toEqual(['p1_only']);
    expect(state.hands.p3.map((c) => c.id)).toEqual(['p2_a', 'p2_b']);
  });

  it('supports Wild Draw Four Challenge (guilty bluff vs honest play)', () => {
    const state = createInitialGameState(
      'r1',
      'custom',
      { challengeWild4: true, stackDrawFour: false },
      makePlayers(3)
    );
    state.currentColor = 'red';
    state.discardPile = [card('top', 'red', '4')];
    // p1 HAS a red card, so playing wild4 is a bluff!
    state.hands.p1 = [card('w4', 'wild', 'wild4'), card('r2', 'red', '2')];
    const p1CountBefore = 1;
    const p2CountBefore = state.hands.p2.length;

    playCardsAction(state, 'p1', ['w4']);
    chooseColorAction(state, 'p1', 'blue');
    expect(state.pendingChallenge?.challengerId).toBe('p2');

    challengeWild4Action(state, 'p2', true);
    // p1 was guilty: p1 draws 4, p2 keeps turn!
    expect(state.hands.p1.length).toBe(p1CountBefore + 4);
    expect(state.hands.p2.length).toBe(p2CountBefore);
    expect(state.currentPlayerId).toBe('p2');
  });

  it('supports multiple identical cards played together', () => {
    const state = createInitialGameState(
      'r1',
      'custom',
      { allowMultipleIdentical: true },
      makePlayers(2)
    );
    state.currentColor = 'yellow';
    state.discardPile = [card('top', 'yellow', '5')];
    state.hands.p1 = [
      card('y8_1', 'yellow', '8'),
      card('y8_2', 'yellow', '8'),
      card('k', 'red', '1'),
    ];

    playCardsAction(state, 'p1', ['y8_1', 'y8_2']);
    expect(state.hands.p1.length).toBe(1);
    expect(state.discardPile.length).toBe(3);
  });
});
