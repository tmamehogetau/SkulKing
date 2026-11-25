import {
  legalPlays,
  resolveTrick,
  type Card,
  type GameState,
  type LegalPlay,
  type PlayedCard,
} from "@skulking/engine";

function handOf(state: GameState, seat: number): Card[] {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`席 ${seat} が見つかりません`);
  return player.hand;
}

/** 手持ちの「強さ」を雑に見積もってビッドにする。 */
export function chooseBid(state: GameState, seat: number): number {
  const hand = handOf(state, seat);
  let strength = 0;

  for (const card of hand) {
    if (card.kind === "suit") {
      if (card.suit === "black") {
        strength += card.rank >= 12 ? 1.1 : card.rank >= 9 ? 0.7 : 0.3;
      } else {
        strength += card.rank >= 13 ? 0.9 : card.rank >= 10 ? 0.55 : 0.15;
      }
      continue;
    }
    switch (card.kind) {
      case "pirate":
        strength += 1.2;
        break;
      case "skullKing":
        strength += 1.3;
        break;
      case "mermaid":
        strength += 0.9;
        break;
      case "tigress":
        strength += 0.8;
        break;
      case "escape":
        strength -= 0.15;
        break;
      default:
        strength += 0.4;
    }
  }

  const competition = Math.max(2, state.players.length);
  const estimate = Math.round(strength / (competition / 2));
  return Math.max(0, Math.min(state.round, estimate));
}

function cardValue(card: Card): number {
  if (card.kind === "suit") return card.suit === "black" ? card.rank + 14 : card.rank;
  if (card.kind === "escape") return 0;
  return 20;
}

function winsTrick(state: GameState, seat: number, option: LegalPlay): boolean {
  const trick = state.current;
  if (!trick) return false;
  const card = handOf(state, seat).find((c) => c.id === option.cardId);
  if (!card) return false;

  const play: PlayedCard = { seat, card };
  if (option.tigressAs) play.tigressAs = option.tigressAs;

  const result = resolveTrick([...trick.plays, play], trick.leadSuit);
  return result.winnerSeat === seat;
}

/** 合法手の中から 1 枚選ぶ。 */
export function chooseCard(state: GameState, seat: number): LegalPlay | undefined {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) return undefined;
  const options = legalPlays(player.hand, state.current);
  if (options.length === 0) return undefined;

  const byValue = (a: { value: number }, b: { value: number }) => a.value - b.value;
  const scored = options.map((option) => {
    const card = player.hand.find((c) => c.id === option.cardId);
    return {
      option,
      value: card ? cardValue(card) : 99,
      wins: winsTrick(state, seat, option),
    };
  });

  const bid = player.bid ?? 0;
  const needTrick = bid > 0 && player.tricksWon < bid;
  const leading = !state.current || state.current.plays.length === 0;

  if (leading) {
    const sorted = [...scored].sort(byValue);
    if (needTrick) {
      const best = sorted[sorted.length - 1];
      return best?.option;
    }
    return sorted[0]?.option;
  }

  if (needTrick) {
    const winners = scored.filter((s) => s.wins).sort(byValue);
    if (winners.length > 0) return winners[0]?.option;
    const cheapest = [...scored].sort(byValue)[0];
    return cheapest?.option;
  }

  const safe = scored.filter((s) => !s.wins).sort(byValue);
  if (safe.length > 0) return safe[0]?.option;
  return [...scored].sort(byValue)[0]?.option;
}
