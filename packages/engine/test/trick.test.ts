import { describe, it } from "node:test";
import { expect } from "./expect.js";
import {
  buildDeck,
  legalPlays,
  resolveTrick,
  type PlayedCard,
  type Trick,
} from "../src/index.js";
import { special, suit } from "./helpers.js";

function play(seat: number, card: PlayedCard["card"], tigressAs?: PlayedCard["tigressAs"]): PlayedCard {
  const p: PlayedCard = { seat, card };
  if (tigressAs) p.tigressAs = tigressAs;
  return p;
}

function emptyTrick(overrides: Partial<Trick> = {}): Trick {
  return {
    index: 1,
    leaderSeat: 0,
    plays: [],
    leadSuit: null,
    resolved: false,
    winnerSeat: null,
    discarded: false,
    nextLeaderSeat: null,
    bonuses: [],
    ...overrides,
  };
}

describe("デッキ", () => {
  it("基本デッキは 70 枚", () => {
    const deck = buildDeck({ includeKraken: false, includeWhiteWhale: false, includeLoot: false });
    expect(deck).toHaveLength(70);
    expect(new Set(deck.map((c) => c.id)).size).toBe(70);
  });

  it("拡張を入れると 74 枚", () => {
    const deck = buildDeck({ includeKraken: true, includeWhiteWhale: true, includeLoot: true });
    expect(deck).toHaveLength(74);
  });
});

describe("マストフォロー", () => {
  it("リードの色を持っていればその色しか出せない", () => {
    const hand = [suit("green", 3), suit("yellow", 9), special("escape")];
    const trick = emptyTrick({ leadSuit: "green", plays: [play(0, suit("green", 7))] });
    const legal = legalPlays(hand, trick).map((l) => l.cardId);
    expect(legal.sort()).toEqual(["escape", "green-3"]);
  });

  it("リードの色を持っていなければ何でも出せる", () => {
    const hand = [suit("yellow", 9), suit("black", 2)];
    const trick = emptyTrick({ leadSuit: "green", plays: [play(0, suit("green", 7))] });
    expect(legalPlays(hand, trick)).toHaveLength(2);
  });

  it("特殊カードはリードの色を持っていても出せる", () => {
    const hand = [suit("green", 3), special("mermaid", "mermaid-1")];
    const trick = emptyTrick({ leadSuit: "green", plays: [play(0, suit("green", 7))] });
    const legal = legalPlays(hand, trick).map((l) => l.cardId);
    expect(legal).toContain("mermaid-1");
  });

  it("リードが特殊カードなら全員自由", () => {
    const hand = [suit("green", 3), suit("yellow", 5)];
    const trick = emptyTrick({ leadSuit: null, plays: [play(0, special("pirate", "pirate-rosie"))] });
    expect(legalPlays(hand, trick)).toHaveLength(2);
  });

  it("タイグレスは海賊と逃走の 2 択になる", () => {
    const hand = [special("tigress")];
    const trick = emptyTrick({ leadSuit: "green", plays: [play(0, suit("green", 7))] });
    const legal = legalPlays(hand, trick);
    expect(legal).toEqual([
      { cardId: "tigress", tigressAs: "pirate" },
      { cardId: "tigress", tigressAs: "escape" },
    ]);
  });
});

describe("トリック裁定", () => {
  it("リードスートの最大が勝つ", () => {
    const result = resolveTrick(
      [play(0, suit("green", 5)), play(1, suit("green", 9)), play(2, suit("green", 2))],
      "green",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("黒は他の色に勝つ", () => {
    const result = resolveTrick(
      [play(0, suit("green", 10)), play(1, suit("black", 2)), play(2, suit("green", 14))],
      "green",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("黒同士は数字が大きいほう", () => {
    const result = resolveTrick(
      [play(0, suit("black", 4)), play(1, suit("black", 9))],
      "green",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("海賊は色カードに勝つ", () => {
    const result = resolveTrick(
      [play(0, suit("black", 14)), play(1, special("pirate", "pirate-rosie"))],
      "black",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("スカルキングは海賊に勝つ", () => {
    const result = resolveTrick(
      [play(0, special("pirate", "pirate-rosie")), play(1, special("skullKing"))],
      null,
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("人魚はスカルキングに勝つ", () => {
    const result = resolveTrick(
      [play(0, special("skullKing")), play(1, special("mermaid", "mermaid-1"))],
      null,
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("人魚は海賊に負ける", () => {
    const result = resolveTrick(
      [play(0, special("mermaid", "mermaid-1")), play(1, special("pirate", "pirate-bendt"))],
      null,
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("3 種が揃うと人魚が勝つ", () => {
    const result = resolveTrick(
      [
        play(0, special("pirate", "pirate-rosie")),
        play(1, special("skullKing")),
        play(2, special("mermaid", "mermaid-2")),
      ],
      null,
    );
    expect(result.winnerSeat).toBe(2);
    expect(result.bonuses).toEqual([{ to: 2, points: 40, reason: "skullKingByMermaid" }]);
  });

  it("同じ強さ同士は先に出したほうが勝つ", () => {
    const result = resolveTrick(
      [play(0, special("mermaid", "mermaid-1")), play(1, special("mermaid", "mermaid-2"))],
      null,
    );
    expect(result.winnerSeat).toBe(0);
  });

  it("全員逃走なら最初の 1 枚が勝つ", () => {
    const result = resolveTrick(
      [play(0, special("escape", "escape-1")), play(1, special("escape", "escape-2"))],
      null,
    );
    expect(result.winnerSeat).toBe(0);
  });

  it("逃走が混ざっても色カードが勝つ", () => {
    const result = resolveTrick(
      [play(0, special("escape", "escape-1")), play(1, suit("yellow", 2))],
      "yellow",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("タイグレスを海賊として出せば色カードに勝つ", () => {
    const result = resolveTrick(
      [play(0, suit("purple", 12)), play(1, special("tigress"), "pirate")],
      "purple",
    );
    expect(result.winnerSeat).toBe(1);
  });

  it("タイグレスを逃走として出せば負ける", () => {
    const result = resolveTrick(
      [play(0, suit("purple", 2)), play(1, special("tigress"), "escape")],
      "purple",
    );
    expect(result.winnerSeat).toBe(0);
  });
});

describe("クラーケンと白クジラ", () => {
  it("クラーケンはトリックを流し、勝てた人が次をリードする", () => {
    const result = resolveTrick(
      [
        play(0, suit("green", 12)),
        play(1, special("kraken")),
        play(2, suit("green", 3)),
      ],
      "green",
    );
    expect(result.discarded).toBe(true);
    expect(result.winnerSeat).toBeNull();
    expect(result.nextLeaderSeat).toBe(0);
    expect(result.bonuses).toEqual([]);
  });

  it("白クジラは特殊カードを無効化し、色カードの最大が勝つ", () => {
    const result = resolveTrick(
      [
        play(0, special("pirate", "pirate-rosie")),
        play(1, special("whiteWhale")),
        play(2, suit("yellow", 6)),
        play(3, suit("green", 9)),
      ],
      null,
    );
    expect(result.winnerSeat).toBe(3);
  });

  it("白クジラ + 特殊カードだけなら流れ、白クジラの人が次をリード", () => {
    const result = resolveTrick(
      [play(0, special("pirate", "pirate-rosie")), play(1, special("whiteWhale"))],
      null,
    );
    expect(result.discarded).toBe(true);
    expect(result.nextLeaderSeat).toBe(1);
  });

  it("クラーケンと白クジラは後から出たほうの効果だけ", () => {
    const whaleThenKraken = resolveTrick(
      [play(0, special("whiteWhale")), play(1, special("kraken")), play(2, suit("green", 9))],
      null,
    );
    expect(whaleThenKraken.discarded).toBe(true);
    expect(whaleThenKraken.nextLeaderSeat).toBe(2);

    const krakenThenWhale = resolveTrick(
      [play(0, special("kraken")), play(1, special("whiteWhale")), play(2, suit("green", 9))],
      null,
    );
    expect(krakenThenWhale.winnerSeat).toBe(2);
  });
});

describe("ボーナス", () => {
  it("14 は 10 点、黒の 14 は 20 点", () => {
    const result = resolveTrick(
      [play(0, suit("green", 14)), play(1, suit("black", 14))],
      "green",
    );
    expect(result.winnerSeat).toBe(1);
    expect(result.bonuses).toEqual([
      { to: 1, points: 10, reason: "fourteen" },
      { to: 1, points: 20, reason: "blackFourteen" },
    ]);
  });

  it("海賊が取った人魚は 20 点", () => {
    const result = resolveTrick(
      [play(0, special("mermaid", "mermaid-1")), play(1, special("pirate", "pirate-harry"))],
      null,
    );
    expect(result.bonuses).toEqual([{ to: 1, points: 20, reason: "mermaidByPirate" }]);
  });

  it("スカルキングが取った海賊は 30 点", () => {
    const result = resolveTrick(
      [play(0, special("pirate", "pirate-harry")), play(1, special("skullKing"))],
      null,
    );
    expect(result.bonuses).toEqual([{ to: 1, points: 30, reason: "pirateBySkullKing" }]);
  });

  it("人魚が取ったスカルキングは 40 点", () => {
    const result = resolveTrick(
      [play(0, special("skullKing")), play(1, special("mermaid", "mermaid-1"))],
      null,
    );
    expect(result.bonuses).toEqual([{ to: 1, points: 40, reason: "skullKingByMermaid" }]);
  });

  it("海賊として出したタイグレスは海賊 1 枚として数える", () => {
    const result = resolveTrick(
      [play(0, special("mermaid", "mermaid-2")), play(1, special("tigress"), "pirate")],
      null,
    );
    expect(result.winnerSeat).toBe(1);
    expect(result.bonuses).toEqual([{ to: 1, points: 20, reason: "mermaidByPirate" }]);
  });
});
