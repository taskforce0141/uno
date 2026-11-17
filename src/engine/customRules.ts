import { DEFAULT_CUSTOM_RULES } from './gameTypes.ts';
import type { CustomRulesConfig, GameMode } from './gameTypes.ts';
import { CLASSIC_RULES } from './classicUno.ts';
import { FLIP_RULES } from './flipUno.ts';

export function resolveRulesForMode(
  mode: GameMode,
  custom?: Partial<CustomRulesConfig>
): CustomRulesConfig {
  const base =
    mode === 'classic'
      ? { ...CLASSIC_RULES }
      : mode === 'flip'
      ? { ...FLIP_RULES }
      : { ...DEFAULT_CUSTOM_RULES, ...(custom ?? {}) };

  // Preserve spectator / late join settings if configured
  if (custom) {
    if (typeof custom.allowSpectators === 'boolean') base.allowSpectators = custom.allowSpectators;
    if (typeof custom.allowLateJoining === 'boolean') base.allowLateJoining = custom.allowLateJoining;
    if (custom.turnTimerSeconds !== undefined) base.turnTimerSeconds = custom.turnTimerSeconds;
    if (custom.startingHandSize !== undefined && mode === 'custom') {
      base.startingHandSize = custom.startingHandSize;
    }
  }

  // Keep sevenORule and zeroSevenRule synchronized
  if (mode === 'custom') {
    const sevenZeroEnabled = Boolean(base.sevenORule || base.zeroSevenRule);
    base.sevenORule = sevenZeroEnabled;
    base.zeroSevenRule = sevenZeroEnabled;

    if (base.scoreBasedGame) {
      base.firstPlayerToWin = false;
    } else {
      base.firstPlayerToWin = true;
    }
  }

  return base;
}

export function summarizeActiveRules(mode: GameMode, rules: CustomRulesConfig): string[] {
  const items: string[] = [];
  items.push(`${rules.startingHandSize} starting cards`);
  items.push(rules.turnTimerSeconds === 0 ? 'Unlimited turn timer' : `${rules.turnTimerSeconds}s turn timer`);

  if (mode === 'flip') {
    items.push('Two-sided Light & Dark decks');
    items.push('Draw Five & Skip Everyone');
  }

  if (rules.stackDrawTwo) items.push('Stack +2');
  if (rules.stackDrawFour) items.push('Stack +4');
  if (rules.stackDrawTwoAndFour) items.push('Stack +2 on +4');
  if (rules.drawUntilPlayable) items.push('Draw until playable');
  if (rules.jumpIn) items.push('Jump-In');
  if (rules.forcePlayAfterDraw) items.push('Force play after draw');
  if (rules.allowMultipleIdentical) items.push('Multi-card play');
  if (rules.sevenORule || rules.zeroSevenRule) items.push('Seven-O Swap & Rotate');
  if (rules.challengeWild4 && mode !== 'flip') items.push('Challenge +4');
  if (rules.scoreBasedGame) {
    items.push(`Target ${rules.targetScore} pts`);
  } else {
    items.push('Single-round win');
  }
  items.push(`UNO penalty: +${rules.unoPenaltyCount}`);
  if (rules.allowSpectators) items.push('Spectators allowed');
  if (rules.allowLateJoining) items.push('Late join allowed');

  return items;
}
