import { describe, it } from "node:test";
import { expect } from "./expect.js";
import {
  applyAction,
  buildDeck,
  createGame,
  GameError,
  getPlayerView,
  legalPlays,
  type Action,
  type GameOptions,
  type GameState,
} from "../src/index.js";
import { seeded, suit, special } from "./helpers.js";

function botAction(state: GameState, rand: () => number): Action {
  if (state.phase === "bidding") {
    return {
      type: "bid",
      seat: state.turnSeat,
      bid: Math.floor(rand() * (state.round + 1)),
    };
  }
  if (state.phase === "playing") {
    const player = state.players.find((p) => p.seat === state.turnSeat);
    if (!player) throw new Error("no player");
    const legal = legalPlays(player.hand, state.current);
    const pick = legal[Math.floor(rand() * legal.length)];
    if (!pick) throw new Error("no legal play");
    const action: Action = { type: "playCard", seat: state.turnSeat, cardId: pick.cardId };
    if (pick.tigressAs) action.tigressAs = pick.tigressAs;
    return action;
  }
  return { type: "nextRound" };
}

interface PlayedGame {
  state: GameState;
  actions: number;
}

function playFullGame(seed: number, playerCount: number, options?: Partial<GameOptions>): PlayedGame {
  let state = createGame({
    players: Array.from({ length: playerCount }, (_, i) => ({ name: `P${i + 1}` })),
    seed,
    options,
  });
  const deckSize = buildDeck(state.options).length;
  const rand = seeded(seed * 7919 + 13);
  let actions = 0;

  while (state.phase !== "gameEnd") {
    // カード保存則
    const inHands = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    const played =
      state.tricks.reduce((sum, t) => sum + t.plays.length, 0) +
      (state.current?.plays.length ?? 0);
    expect(inHands + played + state.deckRemaining).toBe(deckSize);

    if (state.phase === "roundEnd") {
      const summary = state.lastRound;
      expect(summary).not.toBeNull();
      expect(state.tricks).toHaveLength(state.round);
      const tricksWon = state.players.reduce((sum, p) => sum + p.tricksWon, 0);
      // クラーケン・白クジラで流れたトリックは誰の得にもならない
      const wonTricks = state.tricks.filter((t) => t.winnerSeat !== null).length;
      expect(tricksWon).toBe(wonTricks);
      expect(tricksWon).toBeLessThanOrEqual(state.round);
      for (const row of summary!.players) {
        expect(row.total).toBe(row.base + row.bonus);
        expect(row.scoreAfter).toBe(row.scoreBefore + row.total);
        expect(row.bid).toBeGreaterThanOrEqual(0);
        expect(row.bid).toBeLessThanOrEqual(summary!.round);
      }
    }

    state = applyAction(state, botAction(state, rand));
    actions += 1;
    if (actions > 50000) throw new Error("game did not finish");
  }

  return { state, actions };
}

describe("ゲーム進行", () => {
  it("配布枚数はラウンド数と同じ", () => {
    const state = createGame({
      players: [{ name: "A" }, { name: "B" }, { name: "C" }],
      seed: 42,
    });
    expect(state.phase).toBe("bidding");
    expect(state.round).toBe(1);
    for (const player of state.players) expect(player.hand).toHaveLength(1);
    expect(state.deckRemaining).toBe(70 - 3);
  });

  it("シードが同じなら同じ配布になる", () => {
    const a = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 7 });
    const b = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 7 });
    expect(a.players.map((p) => p.hand.map((c) => c.id))).toEqual(
      b.players.map((p) => p.hand.map((c) => c.id)),
    );
  });

  it("全員のビッドが揃うまで他人のビッドは見えない", () => {
    const state = createGame({
      players: [{ name: "A" }, { name: "B" }, { name: "C" }],
      seed: 3,
    });
    const afterFirst = applyAction(state, { type: "bid", seat: state.turnSeat, bid: 0 });
    const otherSeat = state.players.find((p) => p.seat !== state.turnSeat)?.seat ?? 1;
    const view = getPlayerView(afterFirst, otherSeat);
    const bidder = state.turnSeat;
    expect(view.players.find((p) => p.seat === bidder)?.bid).toBeNull();
    expect(getPlayerView(afterFirst, bidder).players.find((p) => p.seat === bidder)?.bid).toBe(0);
  });

  it("手番でないプレイヤーのビッドは拒否される", () => {
    const state = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 11 });
    const other = state.players.find((p) => p.seat !== state.turnSeat)!;
    expect(() => applyAction(state, { type: "bid", seat: other.seat, bid: 0 })).toThrow(GameError);
  });

  it("範囲外のビッドは拒否される", () => {
    const state = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 12 });
    expect(() =>
      applyAction(state, { type: "bid", seat: state.turnSeat, bid: 99 }),
    ).toThrow(GameError);
  });

  it("マストフォロー違反は拒否される", () => {
    const state = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 5 });
    state.phase = "playing";
    state.players[0]!.hand = [suit("green", 3), suit("yellow", 9)];
    state.players[1]!.hand = [suit("green", 8), suit("yellow", 2)];
    state.current = {
      index: 1,
      leaderSeat: 0,
      plays: [{ seat: 0, card: suit("green", 4) }],
      leadSuit: "green",
      resolved: false,
      winnerSeat: null,
      discarded: false,
      nextLeaderSeat: null,
      bonuses: [],
    };
    state.turnSeat = 1;
    state.players[0]!.bid = 1;
    state.players[1]!.bid = 0;

    expect(() =>
      applyAction(state, { type: "playCard", seat: 1, cardId: "yellow-2" }),
    ).toThrow(GameError);
    expect(() =>
      applyAction(state, { type: "playCard", seat: 1, cardId: "green-8" }),
    ).not.toThrow();
  });

  it("ティグレスは扱いを指定しないと出せない", () => {
    const state = createGame({ players: [{ name: "A" }, { name: "B" }], seed: 9 });
    state.phase = "playing";
    state.players[0]!.hand = [special("tigress")];
    state.players[1]!.hand = [suit("green", 8)];
    state.current = {
      index: 1,
      leaderSeat: 0,
      plays: [{ seat: 0, card: suit("green", 4) }],
      leadSuit: "green",
      resolved: false,
      winnerSeat: null,
      discarded: false,
      nextLeaderSeat: null,
      bonuses: [],
    };
    state.turnSeat = 1;
    expect(() =>
      applyAction(state, { type: "playCard", seat: 1, cardId: "tigress" }),
    ).toThrow(GameError);
  });

  it("10 ラウンドを完走し、勝者が決まる", () => {
    const { state } = playFullGame(2026, 4);
    expect(state.phase).toBe("gameEnd");
    expect(state.round).toBe(10);
    expect(state.roundHistory).toHaveLength(10);
    expect(state.winnerSeats.length).toBeGreaterThanOrEqual(1);
    const best = Math.max(...state.players.map((p) => p.score));
    for (const seat of state.winnerSeats) {
      expect(state.players.find((p) => p.seat === seat)?.score).toBe(best);
    }
    const sumOfRounds = state.roundHistory
      .flatMap((r) => r.players)
      .reduce((sum, row) => sum + row.total, 0);
    const sumOfScores = state.players.reduce((sum, p) => sum + p.score, 0);
    expect(sumOfScores).toBe(sumOfRounds);
  });

  it("2〜6 人・拡張ありでも破綻しない", () => {
    for (const playerCount of [2, 3, 5, 6]) {
      for (const seed of [1, 2, 3]) {
        const { state } = playFullGame(seed, playerCount, {
          includeKraken: true,
          includeWhiteWhale: true,
          includeLoot: true,
        });
        expect(state.phase).toBe("gameEnd");
      }
    }
  });

  it("ラウンドごとにリードが左へ移る", () => {
    let state = createGame({ players: [{ name: "A" }, { name: "B" }, { name: "C" }], seed: 88 });
    const leaders: number[] = [state.leaderSeat];
    const rand = seeded(4242);
    let guard = 0;
    while (state.phase !== "gameEnd" && guard++ < 50000) {
      const before = state.phase;
      state = applyAction(state, botAction(state, rand));
      if (before === "roundEnd" && state.phase === "bidding") leaders.push(state.leaderSeat);
    }
    for (let i = 1; i < leaders.length; i++) {
      expect(leaders[i]).toBe((leaders[i - 1]! + 1) % 3);
    }
  });

  it("略奪品は取った人と出した人が両方当てれば +20", () => {
    const state = createGame({
      players: [{ name: "A" }, { name: "B" }],
      seed: 21,
      options: { includeLoot: true },
      firstLeaderSeat: 0,
    });
    state.phase = "playing";
    state.players[0]!.hand = [{ id: "loot-1", kind: "loot" }];
    state.players[1]!.hand = [suit("green", 5)];
    state.players[0]!.bid = 0;
    state.players[1]!.bid = 1;
    state.current = {
      index: 1,
      leaderSeat: 0,
      plays: [],
      leadSuit: null,
      resolved: false,
      winnerSeat: null,
      discarded: false,
      nextLeaderSeat: null,
      bonuses: [],
    };
    state.turnSeat = 0;

    const afterLoot = applyAction(state, { type: "playCard", seat: 0, cardId: "loot-1" });
    const afterGreen = applyAction(afterLoot, { type: "playCard", seat: 1, cardId: "green-5" });

    expect(afterGreen.phase).toBe("roundEnd");
    const row = afterGreen.lastRound?.players.find((entry) => entry.seat === 1);
    expect(row?.tricks).toBe(1);
    expect(row?.base).toBe(20);
    expect(row?.bonus).toBe(20);
    expect(row?.total).toBe(40);
  });

  it("略奪品を出した人がビッドを外すと同盟ボーナスは入らない", () => {
    const state = createGame({
      players: [{ name: "A" }, { name: "B" }],
      seed: 22,
      options: { includeLoot: true },
      firstLeaderSeat: 0,
    });
    state.phase = "playing";
    state.players[0]!.hand = [{ id: "loot-2", kind: "loot" }];
    state.players[1]!.hand = [suit("green", 5)];
    state.players[0]!.bid = 1;
    state.players[1]!.bid = 1;
    state.current = {
      index: 1,
      leaderSeat: 0,
      plays: [],
      leadSuit: null,
      resolved: false,
      winnerSeat: null,
      discarded: false,
      nextLeaderSeat: null,
      bonuses: [],
    };
    state.turnSeat = 0;

    const afterLoot = applyAction(state, { type: "playCard", seat: 0, cardId: "loot-2" });
    const afterGreen = applyAction(afterLoot, { type: "playCard", seat: 1, cardId: "green-5" });

    expect(afterGreen.phase).toBe("roundEnd");
    const row = afterGreen.lastRound?.players.find((entry) => entry.seat === 1);
    expect(row?.bonus).toBe(0);
    expect(row?.total).toBe(20);
  });
});
