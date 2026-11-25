import type { PlayerState, RoundPlayerSummary, RoundSummary, TrickBonus } from "./types.js";

export interface RoundScoreInput {
  round: number;
  players: Pick<PlayerState, "seat" | "bid" | "tricksWon" | "score">[];
  /** そのラウンドの全トリックで発生したボーナス（平坦化済み）。 */
  bonuses: TrickBonus[];
}

function baseScore(bid: number, tricks: number, round: number): { base: number; bidMade: boolean } {
  if (bid === 0) {
    return tricks === 0
      ? { base: 10 * round, bidMade: true }
      : { base: -10 * round, bidMade: false };
  }
  if (tricks === bid) return { base: 20 * bid, bidMade: true };
  return { base: -10 * Math.abs(tricks - bid), bidMade: false };
}

/**
 * 得点計算。ビッド成功時のみボーナスが入る。
 * 略奪品の同盟ボーナスのように「相手もビッドを当てている」ことが条件のものは
 * requiresSeat で判定する。
 */
export function scoreRound(input: RoundScoreInput): RoundSummary {
  const { round, players, bonuses } = input;

  const facts = new Map(
    players.map((player) => [
      player.seat,
      baseScore(player.bid ?? 0, player.tricksWon, round),
    ]),
  );

  const summaries: RoundPlayerSummary[] = players.map((player) => {
    const fact = facts.get(player.seat) ?? { base: 0, bidMade: false };
    const earned = bonuses.filter((bonus) => {
      if (bonus.to !== player.seat) return false;
      if (bonus.requiresSeat === undefined) return true;
      return facts.get(bonus.requiresSeat)?.bidMade === true;
    });
    const bonus = fact.bidMade ? earned.reduce((sum, item) => sum + item.points, 0) : 0;
    const scoreBefore = player.score;
    const total = fact.base + bonus;

    return {
      seat: player.seat,
      bid: player.bid ?? 0,
      tricks: player.tricksWon,
      bidMade: fact.bidMade,
      base: fact.base,
      bonus,
      total,
      scoreBefore,
      scoreAfter: scoreBefore + total,
      bonuses: earned,
    };
  });

  return { round, players: summaries };
}
