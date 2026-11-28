import type { Card, PirateId, Suit, TigressUse } from "./cards.js";
import { legalPlays, type LegalPlay } from "./trick.js";
import type {
  GameOptions,
  GameState,
  Phase,
  PlayedCard,
  RoundSummary,
  Trick,
  TrickBonus,
} from "./types.js";

export interface PublicPlayView {
  seat: number;
  card: Card;
  tigressAs?: TigressUse;
}

export interface TrickView {
  index: number;
  leaderSeat: number;
  plays: PublicPlayView[];
  leadSuit: Suit | null;
  resolved: boolean;
  winnerSeat: number | null;
  discarded: boolean;
  nextLeaderSeat: number | null;
  bonuses: TrickBonus[];
}

export interface PublicPlayerView {
  seat: number;
  name: string;
  handCount: number;
  bid: number | null;
  tricksWon: number;
  score: number;
}

export interface PendingPowerView {
  seat: number;
  pirate: PirateId;
  step: "choose" | "discard";
  isFinalTrick: boolean;
}

export interface PlayerView {
  /** 状態の版番号。小さいビューが届いたら捨てる。 */
  version: number;
  phase: Phase;
  round: number;
  totalRounds: number;
  turnSeat: number;
  leaderSeat: number;
  deckRemaining: number;
  options: GameOptions;
  players: PublicPlayerView[];
  /** 海賊の能力待ち（全員に見える）。 */
  pendingPower: PendingPowerView | null;
  you: {
    seat: number;
    name: string;
    hand: Card[];
    bid: number | null;
    legalPlays: LegalPlay[];
    canAct: boolean;
    canAdvance: boolean;
    /** 自分の能力待ちなら中身が入る。 */
    power: PendingPowerView | null;
    /** ファニータで覗いた山札（本人にだけ）。 */
    peek: Card[] | null;
    /** ラスカルのサイドベット（このラウンド分）。 */
    sideBet: number;
  };
  currentTrick: TrickView | null;
  tricks: TrickView[];
  lastRound: RoundSummary | null;
  /** 終わったラウンドの履歴（スコアボード用）。 */
  roundHistory: RoundSummary[];
  winnerSeats: number[];
}

function toTrickView(trick: Trick): TrickView {
  return {
    index: trick.index,
    leaderSeat: trick.leaderSeat,
    plays: trick.plays.map((play: PlayedCard) => {
      const view: PublicPlayView = { seat: play.seat, card: play.card };
      if (play.tigressAs) view.tigressAs = play.tigressAs;
      return view;
    }),
    leadSuit: trick.leadSuit,
    resolved: trick.resolved,
    winnerSeat: trick.winnerSeat,
    discarded: trick.discarded,
    nextLeaderSeat: trick.nextLeaderSeat,
    bonuses: trick.bonuses,
  };
}

/**
 * 1 人のプレイヤーから見える状態。他人の手札は枚数だけにする。
 * ビッドは全員分が揃うまで他人には伏せる。
 */
export function getPlayerView(state: GameState, seat: number): PlayerView {
  const self = state.players.find((p) => p.seat === seat);
  if (!self) throw new Error(`席 ${seat} が見つかりません`);

  const bidsOpen = state.phase !== "bidding";
  const pending = state.pendingPower;
  const myPower =
    pending && pending.seat === seat
      ? {
          seat: pending.seat,
          pirate: pending.pirate,
          step: pending.step,
          isFinalTrick: pending.isFinalTrick,
        }
      : null;
  const sideBet = state.sideBets.find((bet) => bet.seat === seat)?.amount ?? 0;

  return {
    version: state.version,
    phase: state.phase,
    round: state.round,
    totalRounds: state.options.totalRounds,
    turnSeat: state.turnSeat,
    leaderSeat: state.leaderSeat,
    deckRemaining: state.deck.length,
    options: state.options,
    players: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      handCount: p.hand.length,
      bid: bidsOpen || p.seat === seat ? p.bid : null,
      tricksWon: p.tricksWon,
      score: p.score,
    })),
    pendingPower: pending
      ? {
          seat: pending.seat,
          pirate: pending.pirate,
          step: pending.step,
          isFinalTrick: pending.isFinalTrick,
        }
      : null,
    you: {
      seat: self.seat,
      name: self.name,
      hand: self.hand.map((card) => ({ ...card })),
      bid: self.bid,
      legalPlays: legalPlays(self.hand, state.current),
      canAct:
        !pending &&
        (state.phase === "bidding" || state.phase === "playing") &&
        state.turnSeat === seat,
      canAdvance: state.phase === "roundEnd",
      power: myPower,
      peek: myPower && myPower.pirate === "juanita" ? state.deck.map((card) => ({ ...card })) : null,
      sideBet,
    },
    currentTrick: state.current ? toTrickView(state.current) : null,
    tricks: state.tricks.map(toTrickView),
    lastRound: state.lastRound,
    roundHistory: state.roundHistory,
    winnerSeats: state.winnerSeats,
  };
}
