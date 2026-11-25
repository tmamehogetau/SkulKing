import { describe, it } from "node:test";
import { expect } from "./expect.js";
import { scoreRound, type TrickBonus } from "../src/index.js";

describe("得点計算", () => {
  it("ビッド的中は 20 × ビッド数", () => {
    const summary = scoreRound({
      round: 3,
      players: [
        { seat: 0, bid: 2, tricksWon: 2, score: 0 },
        { seat: 1, bid: 1, tricksWon: 0, score: 0 },
      ],
      bonuses: [],
    });
    expect(summary.players[0]).toMatchObject({ base: 40, bonus: 0, total: 40, bidMade: true });
    expect(summary.players[1]).toMatchObject({ base: -10, total: -10, bidMade: false });
  });

  it("ズレは 10 点 × ズレ幅", () => {
    const summary = scoreRound({
      round: 4,
      players: [{ seat: 0, bid: 1, tricksWon: 4, score: 0 }],
      bonuses: [],
    });
    expect(summary.players[0]?.total).toBe(-30);
  });

  it("0 ビッド成功は 10 × ラウンド数", () => {
    const summary = scoreRound({
      round: 7,
      players: [
        { seat: 0, bid: 0, tricksWon: 0, score: 0 },
        { seat: 1, bid: 0, tricksWon: 2, score: 0 },
      ],
      bonuses: [],
    });
    expect(summary.players[0]?.total).toBe(70);
    expect(summary.players[1]?.total).toBe(-70);
  });

  it("ビッドを外すとボーナスは没収", () => {
    const bonuses: TrickBonus[] = [{ to: 0, points: 30, reason: "pirateBySkullKing" }];
    const made = scoreRound({
      round: 5,
      players: [{ seat: 0, bid: 1, tricksWon: 1, score: 10 }],
      bonuses,
    });
    expect(made.players[0]).toMatchObject({ base: 20, bonus: 30, total: 50, scoreAfter: 60 });

    const missed = scoreRound({
      round: 5,
      players: [{ seat: 0, bid: 1, tricksWon: 2, score: 10 }],
      bonuses,
    });
    expect(missed.players[0]).toMatchObject({ base: -10, bonus: 0, total: -10, scoreAfter: 0 });
  });

  it("ボーナスは取った人にだけ入る", () => {    const summary = scoreRound({
      round: 2,
      players: [
        { seat: 0, bid: 1, tricksWon: 1, score: 0 },
        { seat: 1, bid: 1, tricksWon: 1, score: 0 },
      ],
      bonuses: [{ to: 1, points: 40, reason: "skullKingByMermaid" }],
    });
    expect(summary.players[0]?.total).toBe(20);
    expect(summary.players[1]?.total).toBe(60);
  });

  it("略奪品の同盟ボーナスは出した人もビッドを当てている必要がある", () => {
    const bonuses: TrickBonus[] = [
      { to: 0, points: 20, reason: "lootAlliance", requiresSeat: 1 },
    ];
    const both = scoreRound({
      round: 5,
      players: [
        { seat: 0, bid: 1, tricksWon: 1, score: 0 },
        { seat: 1, bid: 2, tricksWon: 2, score: 0 },
      ],
      bonuses,
    });
    expect(both.players[0]?.bonus).toBe(20);
    expect(both.players[0]?.total).toBe(40);

    const broken = scoreRound({
      round: 5,
      players: [
        { seat: 0, bid: 1, tricksWon: 1, score: 0 },
        { seat: 1, bid: 2, tricksWon: 1, score: 0 },
      ],
      bonuses,
    });
    expect(broken.players[0]?.bonus).toBe(0);
    expect(broken.players[0]?.total).toBe(20);
  });
});
