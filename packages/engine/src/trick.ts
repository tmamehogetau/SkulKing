import { isSuitCard, resolvedKind, type Card, type Suit, type TigressUse } from "./cards.js";
import type { PlayedCard, Trick, TrickBonus } from "./types.js";

export interface LegalPlay {
  cardId: string;
  tigressAs?: TigressUse;
}

/**
 * マストフォローと特殊カードの例外を反映した合法手。
 * - リードが特殊カード（リードスートなし）: すべて出せる
 * - リードスートがある: その色を持っていればその色のみ（＋特殊カードは常に可）
 * - 持っていなければすべて出せる
 */
export function legalPlays(hand: Card[], trick: Trick | null): LegalPlay[] {
  const all: LegalPlay[] = hand.flatMap((card) =>
    card.kind === "tigress"
      ? [
          { cardId: card.id, tigressAs: "pirate" as const },
          { cardId: card.id, tigressAs: "escape" as const },
        ]
      : [{ cardId: card.id }],
  );

  if (!trick || trick.plays.length === 0 || trick.leadSuit === null) return all;

  const leadSuit = trick.leadSuit;
  const followers = hand.filter((c) => isSuitCard(c) && c.suit === leadSuit);
  if (followers.length === 0) return all;

  const specials = hand.filter((c) => !isSuitCard(c));
  const followerIds = new Set(followers.map((c) => c.id));
  return all.filter((p) => followerIds.has(p.cardId) || specials.some((s) => s.id === p.cardId));
}

type IndexedPlay = { play: PlayedCard; index: number };

/**
 * 白クジラ・クラーケンの効果を除いた素の裁定。
 * 誰も勝てない（空）場合は null。
 */
function pickWinner(plays: PlayedCard[], leadSuit: Suit | null): PlayedCard | null {
  if (plays.length === 0) return null;

  const indexed: IndexedPlay[] = plays.map((play, index) => ({ play, index }));
  const ofKind = (kind: ReturnType<typeof resolvedKind>) =>
    indexed.filter((p) => resolvedKind(p.play.card, p.play.tigressAs) === kind);

  const pirates = ofKind("pirate");
  const mermaids = ofKind("mermaid");
  const skullKings = ofKind("skullKing");

  // 3 種が揃ったときは人魚が勝つ（BGA 明記）。
  if (pirates.length > 0 && mermaids.length > 0 && skullKings.length > 0) {
    return mermaids[0]!.play;
  }
  // スカルキングは海賊に勝つ（人魚がいないとき）。
  if (pirates.length > 0 && skullKings.length > 0) return skullKings[0]!.play;
  // 海賊は人魚と色カードに勝つ。
  if (pirates.length > 0) return pirates[0]!.play;
  // 人魚はスカルキングと色カードに勝つ。
  if (mermaids.length > 0) return mermaids[0]!.play;
  if (skullKings.length > 0) return skullKings[0]!.play;

  const suits = indexed.filter((p) => p.play.card.kind === "suit");
  // 逃走・略奪品・その他のみ: 最初に出した人が勝つ
  if (suits.length === 0) return indexed[0]!.play;

  const blacks = suits.filter(
    (p) => p.play.card.kind === "suit" && p.play.card.suit === "black",
  );
  const sameLead =
    leadSuit === null
      ? suits
      : suits.filter((p) => p.play.card.kind === "suit" && p.play.card.suit === leadSuit);

  const pool = blacks.length > 0 ? blacks : sameLead.length > 0 ? sameLead : suits;

  let best = pool[0]!;
  for (const candidate of pool) {
    const a = best.play.card;
    const b = candidate.play.card;
    if (a.kind !== "suit" || b.kind !== "suit") continue;
    if (b.rank > a.rank) best = candidate;
  }
  return best.play;
}

function bonusFor(winner: PlayedCard, plays: PlayedCard[], winnerSeat: number): TrickBonus[] {
  const bonuses: TrickBonus[] = [];

  for (const p of plays) {
    if (p.card.kind === "suit" && p.card.rank === 14) {
      bonuses.push({
        to: winnerSeat,
        points: p.card.suit === "black" ? 20 : 10,
        reason: p.card.suit === "black" ? "blackFourteen" : "fourteen",
      });
    }
  }

  const winnerKind = resolvedKind(winner.card, winner.tigressAs);
  if (winnerKind === "pirate") {
    for (const p of plays) {
      if (resolvedKind(p.card, p.tigressAs) === "mermaid") {
        bonuses.push({ to: winnerSeat, points: 20, reason: "mermaidByPirate" });
      }
    }
  }
  if (winnerKind === "skullKing") {
    for (const p of plays) {
      if (resolvedKind(p.card, p.tigressAs) === "pirate") {
        bonuses.push({ to: winnerSeat, points: 30, reason: "pirateBySkullKing" });
      }
    }
  }
  if (winnerKind === "mermaid") {
    for (const p of plays) {
      if (resolvedKind(p.card, p.tigressAs) === "skullKing") {
        bonuses.push({ to: winnerSeat, points: 40, reason: "skullKingByMermaid" });
      }
    }
  }

  return bonuses;
}

export interface TrickResolution {
  winnerSeat: number | null;
  discarded: boolean;
  nextLeaderSeat: number;
  bonuses: TrickBonus[];
}

/**
 * 1 トリックを裁定する。クラーケン／白クジラの「あとから出たほうの効果」もここで処理する。
 */
export function resolveTrick(plays: PlayedCard[], leadSuit: Suit | null): TrickResolution {
  const firstLeader = plays[0]?.seat;
  if (firstLeader === undefined) {
    throw new Error("resolveTrick: no plays");
  }

  const indexOfKind = (kind: ReturnType<typeof resolvedKind>) =>
    plays.findIndex((p) => resolvedKind(p.card, p.tigressAs) === kind);

  const krakenIdx = indexOfKind("kraken");
  const whaleIdx = indexOfKind("whiteWhale");

  let useKraken = krakenIdx >= 0;
  let useWhale = whaleIdx >= 0;
  if (useKraken && useWhale) {
    // あとから出たほうだけ有効
    if (krakenIdx > whaleIdx) useWhale = false;
    else useKraken = false;
  }

  if (useKraken) {
    const withoutKraken = plays.filter((p) => resolvedKind(p.card, p.tigressAs) !== "kraken");
    const wouldBeWinner = pickWinner(withoutKraken, leadSuit);
    return {
      winnerSeat: null,
      discarded: true,
      nextLeaderSeat: wouldBeWinner?.seat ?? firstLeader,
      bonuses: [],
    };
  }

  if (useWhale) {
    const suitPlays = plays.filter((p) => p.card.kind === "suit");
    if (suitPlays.length === 0) {
      return {
        winnerSeat: null,
        discarded: true,
        nextLeaderSeat: plays[whaleIdx]!.seat,
        bonuses: [],
      };
    }
    let best = suitPlays[0]!;
    for (const p of suitPlays) {
      if (p.card.kind !== "suit" || best.card.kind !== "suit") continue;
      if (p.card.rank > best.card.rank) best = p;
    }
    return {
      winnerSeat: best.seat,
      discarded: false,
      nextLeaderSeat: best.seat,
      bonuses: bonusFor(best, plays, best.seat),
    };
  }

  const winner = pickWinner(plays, leadSuit);
  if (!winner) {
    return { winnerSeat: null, discarded: true, nextLeaderSeat: firstLeader, bonuses: [] };
  }
  return {
    winnerSeat: winner.seat,
    discarded: false,
    nextLeaderSeat: winner.seat,
    bonuses: bonusFor(winner, plays, winner.seat),
  };
}
