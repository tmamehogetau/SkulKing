import {
  legalPlays,
  resolveTrick,
  type Action,
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
      // 拡張カード。いずれも自分ではトリックを取れないので、取る力としては数えない。
      case "loot":
        // 略奪品は勝てないうえ、置いたトリックの勝者に +20 を渡す。持っているだけで不利。
        strength -= 0.1;
        break;
      case "kraken":
        // クラーケンは流すだけで取れない。強い札を流せるが、ビッドの当てにはならない。
        break;
      case "whiteWhale":
        // 白クジラも自分では勝てない。特殊札を無効化する防御札としてわずかにプラス。
        strength += 0.05;
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
  // 拡張カードは「取れない札」として扱う。略奪品は早めに手放したいので低く、
  // クラーケン／白クジラは切り札なので、負け札が尽きるまで温存する。
  if (card.kind === "loot") return 6;
  if (card.kind === "whiteWhale") return 16;
  if (card.kind === "kraken") return 18;
  return 20;
}

/** 自分ではトリックを取れない札（勝ち筋として数えない）。 */
function cannotWinBySelf(card: Card): boolean {
  return card.kind === "loot" || card.kind === "escape";
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
      card,
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
      // 略奪品と逃走では勝てないので、勝ちにいくときは選ばない
      const winnable = sorted.filter((s) => s.card && !cannotWinBySelf(s.card));
      const best = winnable[winnable.length - 1] ?? sorted[sorted.length - 1];
      return best?.option;
    }
    return sorted[0]?.option;
  }

  if (needTrick) {
    const winners = scored
      .filter((s) => s.wins && s.card && !cannotWinBySelf(s.card))
      .sort(byValue);
    if (winners.length > 0) return winners[0]?.option;
    // 勝てる札が無いときは、いちばん安い札を流す
    const cheapest = [...scored].sort(byValue)[0];
    return cheapest?.option;
  }

  // 取らなくてよい場面。クラーケン／白クジラも「勝てない札」なので、
  // 安い負け札が尽きたときの逃げ道としてここで自然に使われる。
  const safe = scored.filter((s) => !s.wins).sort(byValue);
  if (safe.length > 0) return safe[0]?.option;
  return [...scored].sort(byValue)[0]?.option;
}

const POWER_LABEL: Record<string, string> = {
  rosie: "ロージー",
  bendt: "ベント",
  rascal: "ラスカル",
  juanita: "ファニータ",
  harry: "ハリー",
};

/** 海賊の能力をどう使うか決める（ボット用）。 */
export function choosePower(state: GameState, seat: number): Action {
  const pending = state.pendingPower;
  if (!pending) throw new Error("能力待ちではありません");

  if (pending.step === "discard") {
    const player = state.players.find((p) => p.seat === seat);
    const cheapest = [...(player?.hand ?? [])]
      .sort((a, b) => cardValue(a) - cardValue(b))
      .slice(0, 2)
      .map((card) => card.id);
    return { type: "power", seat, kind: "discard", cardIds: cheapest };
  }

  switch (pending.pirate) {
    case "rosie":
      // 自分でリードを続けるのがいちばん無難
      return { type: "power", seat, kind: "lead", leaderSeat: seat };
    case "bendt":
      return { type: "power", seat, kind: "draw" };
    case "rascal": {
      const player = state.players.find((p) => p.seat === seat);
      const amount = (player?.bid ?? 0) > 0 ? 10 : 0;
      return { type: "power", seat, kind: "sideBet", amount };
    }
    case "juanita":
      return { type: "power", seat, kind: "peek" };
    case "harry": {
      const player = state.players.find((p) => p.seat === seat);
      const delta: 1 | -1 = (player?.bid ?? 0) < state.round ? 1 : -1;
      return { type: "power", seat, kind: "bidAdjust", delta };
    }
  }
}

export function powerName(pirate: string): string {
  return POWER_LABEL[pirate] ?? pirate;
}

