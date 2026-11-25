import type { Card, Suit, TigressUse } from "./cards.js";

export type Phase = "bidding" | "playing" | "roundEnd" | "gameEnd";

export interface GameOptions {
  totalRounds: number;
  includeKraken: boolean;
  includeWhiteWhale: boolean;
  includeLoot: boolean;
  piratePowers: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  totalRounds: 10,
  includeKraken: false,
  includeWhiteWhale: false,
  includeLoot: false,
  piratePowers: false,
};

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  hand: Card[];
  bid: number | null;
  tricksWon: number;
  score: number;
}

export interface PlayedCard {
  seat: number;
  card: Card;
  tigressAs?: TigressUse;
}

export type BonusReason =
  | "fourteen"
  | "blackFourteen"
  | "mermaidByPirate"
  | "pirateBySkullKing"
  | "skullKingByMermaid"
  | "lootAlliance";

export interface TrickBonus {
  to: number;
  points: number;
  reason: BonusReason;
  /** この席もビッドを当てている必要がある（略奪品の同盟）。 */
  requiresSeat?: number;
}

export interface Trick {
  index: number;
  leaderSeat: number;
  plays: PlayedCard[];
  /** リードが特殊カードのとき、最初の色カードが出るまで null。 */
  leadSuit: Suit | null;
  resolved: boolean;
  /** 流れたトリック（クラーケン・白クジラ）や未解決では null。 */
  winnerSeat: number | null;
  discarded: boolean;
  nextLeaderSeat: number | null;
  bonuses: TrickBonus[];
}

export interface RoundPlayerSummary {
  seat: number;
  bid: number;
  tricks: number;
  bidMade: boolean;
  base: number;
  /** ビッド失敗時は 0。 */
  bonus: number;
  total: number;
  scoreBefore: number;
  scoreAfter: number;
  bonuses: TrickBonus[];
}

export interface RoundSummary {
  round: number;
  players: RoundPlayerSummary[];
}

export interface GameState {
  seed: number;
  rng: number;
  /** アクションごとに 1 増える。クライアントが古いビューを捨てるために使う。 */
  version: number;
  options: GameOptions;
  players: PlayerState[];
  round: number;
  phase: Phase;
  /** そのラウンドの最初のリード。 */
  leaderSeat: number;
  /** 次に行動する席（ビッド or カード）。 */
  turnSeat: number;
  deckRemaining: number;
  tricks: Trick[];
  current: Trick | null;
  roundHistory: RoundSummary[];
  lastRound: RoundSummary | null;
  winnerSeats: number[];
}

export type Action =
  | { type: "bid"; seat: number; bid: number }
  | { type: "playCard"; seat: number; cardId: string; tigressAs?: TigressUse }
  | { type: "nextRound" };

export class GameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}
