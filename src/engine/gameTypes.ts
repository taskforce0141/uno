export type GameMode = 'classic' | 'flip' | 'custom';

export type LightColor = 'red' | 'blue' | 'green' | 'yellow';
export type DarkColor = 'pink' | 'teal' | 'orange' | 'purple';
export type CardColor = LightColor | DarkColor;
export type FlipSide = 'light' | 'dark';

export type ClassicCardValue =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'wild'
  | 'wild4';

export type FlipLightValue =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'draw1'
  | 'skip'
  | 'reverse'
  | 'flip'
  | 'wild'
  | 'wild2';

export type FlipDarkValue =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'draw5'
  | 'skip_everyone'
  | 'reverse'
  | 'flip'
  | 'wild'
  | 'wild_draw_color';

export type AnyCardValue = ClassicCardValue | FlipLightValue | FlipDarkValue;

export interface CardFace {
  color: CardColor | 'wild';
  value: AnyCardValue;
}

export interface UnoCard {
  id: string;
  light: CardFace;
  dark?: CardFace;
}

export interface CustomRulesConfig {
  startingHandSize: 5 | 6 | 7 | 8 | 10;
  turnTimerSeconds: 15 | 30 | 45 | 60 | 0; // 0 = unlimited
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

export const DEFAULT_CUSTOM_RULES: CustomRulesConfig = {
  startingHandSize: 7,
  turnTimerSeconds: 30,
  stackDrawTwo: true,
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
  allowSpectators: false,
  allowLateJoining: false,
};

export type ConnectionStatus = 'online' | 'reconnecting' | 'offline';

export interface PlayerRecord {
  id: string;
  username: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  isSpectator?: boolean;
  connectionStatus: ConnectionStatus;
  joinedAt: number;
  lastSeen: number;
}

export interface PublicPlayerState {
  id: string;
  username: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  isSpectator: boolean;
  cardCount: number;
  score: number;
  calledUno: boolean;
  unoVulnerable: boolean;
  connectionStatus: ConnectionStatus;
}

export interface ActivityEntry {
  id: string;
  playerId: string;
  message: string;
  timestamp: number;
  tone?: 'neutral' | 'action' | 'uno' | 'flip' | 'win' | 'penalty';
}

export interface PendingChallenge {
  offenderId: string;
  challengerId: string;
  previousColor: CardColor;
  wasIllegalBluff: boolean;
  drawCount: number;
}

export interface RoundStanding {
  playerId: string;
  username: string;
  avatar: string;
  remainingCards: number;
  roundPointsGained: number;
  totalScore: number;
  rank: number;
}

export type GameStatus = 'waiting' | 'playing' | 'round_over' | 'finished';

export interface PublicGameState {
  roomId: string;
  gameMode: GameMode;
  rules: CustomRulesConfig;
  gameStatus: GameStatus;
  roundNumber: number;
  currentPlayerId: string;
  currentDirection: 1 | -1;
  currentColor: CardColor;
  currentSide: FlipSide;
  discardTopCard: UnoCard | null;
  discardCount: number;
  drawPileCount: number;
  pendingDrawCount: number;
  pendingDrawSource: 'draw1' | 'draw2' | 'wild2' | 'wild4' | 'draw5' | 'wild_draw_color' | null;
  pendingColorChoiceBy: string | null;
  pendingSwapBy: string | null;
  pendingChallenge: Omit<PendingChallenge, 'wasIllegalBluff'> | null;
  hasDrawnThisTurnBy: string | null;
  drawnCardPlayableId: string | null;
  turnExpiresAt: number | null;
  players: PublicPlayerState[];
  winnerId: string | null;
  roundWinnerId: string | null;
  roundStandings: RoundStanding[];
  lastAction: string;
  activityLog: ActivityEntry[];
  actionSeq: number;
}

export interface ServerGameState {
  roomId: string;
  gameMode: GameMode;
  rules: CustomRulesConfig;
  gameStatus: GameStatus;
  roundNumber: number;
  currentPlayerId: string;
  currentDirection: 1 | -1;
  currentColor: CardColor;
  currentSide: FlipSide;
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  hands: Record<string, UnoCard[]>;
  scores: Record<string, number>;
  calledUno: Record<string, boolean>;
  unoVulnerable: Record<string, boolean>;
  pendingDrawCount: number;
  pendingDrawSource: 'draw1' | 'draw2' | 'wild2' | 'wild4' | 'draw5' | 'wild_draw_color' | null;
  pendingColorChoiceBy: string | null;
  pendingSwapBy: string | null;
  pendingChallenge: PendingChallenge | null;
  hasDrawnThisTurnBy: string | null;
  drawnCardPlayableId: string | null;
  turnExpiresAt: number | null;
  players: PlayerRecord[];
  winnerId: string | null;
  roundWinnerId: string | null;
  roundStandings: RoundStanding[];
  lastAction: string;
  activityLog: ActivityEntry[];
  actionSeq: number;
  processedActionIds: string[];
}

export interface RoomData {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostId: string;
  privacy: 'private';
  gameMode: GameMode;
  maxPlayers: number;
  status: 'waiting' | 'lobby' | 'playing' | 'finished' | 'closed';
  customRules: CustomRulesConfig;
  players: PlayerRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface AvatarOption {
  id: string;
  label: string;
  imageUrl?: string;
  accent: string;
  initials: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: 'crimson',
    label: 'Crimson Ace',
    imageUrl: '/src/assets/images/avatar_crimson_1794882232565.jpg',
    accent: 'from-rose-500 to-red-600',
    initials: 'CA',
  },
  {
    id: 'cobalt',
    label: 'Cobalt Tactician',
    imageUrl: '/src/assets/images/avatar_cobalt_1794882232974.jpg',
    accent: 'from-blue-500 to-indigo-600',
    initials: 'CT',
  },
  {
    id: 'emerald',
    label: 'Emerald Strategist',
    imageUrl: '/src/assets/images/avatar_emerald_1794882233287.jpg',
    accent: 'from-emerald-500 to-teal-600',
    initials: 'ES',
  },
  {
    id: 'amber',
    label: 'Amber Wildcard',
    imageUrl: '/src/assets/images/avatar_amber_1794882233554.jpg',
    accent: 'from-amber-400 to-orange-500',
    initials: 'AW',
  },
  {
    id: 'violet',
    label: 'Violet Flip',
    accent: 'from-purple-500 to-fuchsia-600',
    initials: 'VF',
  },
  {
    id: 'coral',
    label: 'Coral Spark',
    accent: 'from-pink-500 to-rose-500',
    initials: 'CS',
  },
  {
    id: 'cyan',
    label: 'Teal Pulse',
    accent: 'from-cyan-500 to-teal-600',
    initials: 'TP',
  },
  {
    id: 'slate',
    label: 'Obsidian Pro',
    accent: 'from-slate-600 to-slate-800',
    initials: 'OP',
  },
];

export const LIGHT_COLORS: LightColor[] = ['red', 'blue', 'green', 'yellow'];
export const DARK_COLORS: DarkColor[] = ['pink', 'teal', 'orange', 'purple'];
