import type { Card, PirateId, Suit, TigressUse } from "./cards.js";

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
  /** ラスカルのサイドベット（成功で +、失敗で −、未使用は 0）。 */
  sideBet: number;
  total: number;
  scoreBefore: number;
  scoreAfter: number;
  bonuses: TrickBonus[];
  /** 能力で変更した場合の元のビッド。 */
  originalBid?: number;
}

export interface RoundSummary {
  round: number;
  players: RoundPlayerSummary[];
}

export type PowerStep = "choose" | "discard";

/** トリックを取った海賊の能力待ち。 */
export interface PendingPower {
  seat: number;
  pirate: PirateId;
  step: PowerStep;
  /** ラウンド最後のトリック（ハリーのみ許可）。 */
  isFinalTrick: boolean;
}

export interface SideBet {
  seat: number;
  amount: number;
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
  /** 次に行動する席（ビッド or カード or 能力）。 */
  turnSeat: number;
  /** 配り終えたあとに残った山札（ベントの引き・ファニータの覗き見用）。 */
  deck: Card[];
  /** ベントが捨てたカード（監査・保存則のため保持）。 */
  discardPile: Card[];
  tricks: Trick[];
  current: Trick | null;
  pendingPower: PendingPower | null;
  sideBets: SideBet[];
  roundHistory: RoundSummary[];
  lastRound: RoundSummary | null;
  winnerSeats: number[];
}

export type Action =
  | { type: "bid"; seat: number; bid: number }
  | { type: "playCard"; seat: number; cardId: string; tigressAs?: TigressUse }
  | { type: "nextRound" }
  | { type: "power"; seat: number; kind: "skip" }
  | { type: "power"; seat: number; kind: "lead"; leaderSeat: number }
  | { type: "power"; seat: number; kind: "draw" }
  | { type: "power"; seat: number; kind: "discard"; cardIds: string[] }
  | { type: "power"; seat: number; kind: "sideBet"; amount: number }
  | { type: "power"; seat: number; kind: "peek" }
  | { type: "power"; seat: number; kind: "bidAdjust"; delta: 1 | -1 };

export class GameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

