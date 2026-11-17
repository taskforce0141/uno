import { DEFAULT_CUSTOM_RULES } from './gameTypes.ts';
import type { CustomRulesConfig } from './gameTypes.ts';

export const CLASSIC_RULES: CustomRulesConfig = {
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
  challengeWild4: true,
  unoPenaltyCount: 2,
  firstPlayerToWin: true,
  scoreBasedGame: false,
  targetScore: 500,
};

export function getClassicModeDescription(): string[] {
  return [
    '108-card traditional deck (Red, Blue, Green, Yellow)',
    'Match color, number, or action symbol',
    'Wild Draw Four challenges enabled',
    '7-card starting hands · First player to empty hand wins',
  ];
}
