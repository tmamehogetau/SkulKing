import { describe, it } from "node:test";
import {
  applyAction,
  createGame,
  getPlayerView,
  type Card,
  type GameState,
  type PirateId,
} from "../src/index.js";
import { expect } from "./expect.js";
import { special, suit } from "./helpers.js";

function baseState(pirate: PirateId | null, options: { piratePowers: boolean }): GameState {
  const state = createGame({
    players: [{ name: "A" }, { name: "B" }],
    seed: 11,
    options,
    firstLeaderSeat: 0,
  });

  state.round = 2;
  state.phase = "playing";
  state.players[0]!.hand = pirate
    ? [special("pirate", `pirate-${pirate}`, pirate), suit("green", 2)]
    : [suit("green", 7), suit("green", 2)];
  state.players[1]!.hand = [suit("green", 5), suit("green", 6)];
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
  state.deck = [suit("purple", 1), suit("purple", 2), suit("purple", 3), suit("purple", 4)];
  return state;
}

/** 1 トリック遊んで、勝者を返す（A が勝つ想定）。 */
function playFirstTrick(state: GameState): GameState {
  const lead = state.players[0]!.hand[0]!;
  const afterA = applyAction(state, { type: "playCard", seat: 0, cardId: lead.id });
  return applyAction(afterA, { type: "playCard", seat: 1, cardId: "green-5" });
}

describe("海賊の能力", () => {
  it("オプション OFF なら能力待ちにならず次へ進む", () => {
    const state = playFirstTrick(baseState("rosie", { piratePowers: false }));
    expect(state.pendingPower).toBeNull();
    expect(state.current?.leaderSeat).toBe(0);
  });

  it("海賊で取ると能力待ちになる", () => {
    const state = playFirstTrick(baseState("rosie", { piratePowers: true }));
    expect(state.pendingPower).toMatchObject({ seat: 0, pirate: "rosie", step: "choose" });
    expect(state.current).toBeNull();
    expect(state.turnSeat).toBe(0);
  });

  it("能力を使わずスキップできる", () => {
    const state = applyAction(playFirstTrick(baseState("rosie", { piratePowers: true })), {
      type: "power",
      seat: 0,
      kind: "skip",
    });
    expect(state.pendingPower).toBeNull();
    expect(state.current?.leaderSeat).toBe(0);
  });

  it("ロージーは次のリードを選べる", () => {
    const state = applyAction(playFirstTrick(baseState("rosie", { piratePowers: true })), {
      type: "power",
      seat: 0,
      kind: "lead",
      leaderSeat: 1,
    });
    expect(state.current?.leaderSeat).toBe(1);
    expect(state.turnSeat).toBe(1);
  });

  it("ベントは 2 枚引いて 2 枚捨てる", () => {
    const drawn = applyAction(playFirstTrick(baseState("bendt", { piratePowers: true })), {
      type: "power",
      seat: 0,
      kind: "draw",
    });
    expect(drawn.players[0]!.hand).toHaveLength(3);
    expect(drawn.deck).toHaveLength(2);
    expect(drawn.pendingPower).toMatchObject({ step: "discard" });

    const ids = drawn.players[0]!.hand.slice(0, 2).map((card: Card) => card.id);
    const discarded = applyAction(drawn, { type: "power", seat: 0, kind: "discard", cardIds: ids });
    expect(discarded.players[0]!.hand).toHaveLength(1);
    expect(discarded.pendingPower).toBeNull();
    expect(discarded.current?.leaderSeat).toBe(0);
  });

  it("ラスカルはサイドベットを記録する", () => {
    const state = applyAction(playFirstTrick(baseState("rascal", { piratePowers: true })), {
      type: "power",
      seat: 0,
      kind: "sideBet",
      amount: 20,
    });
    expect(state.sideBets).toEqual([{ seat: 0, amount: 20 }]);
    expect(state.pendingPower).toBeNull();
  });

  it("ファニータは本人にだけ山札を見せる", () => {
    const state = playFirstTrick(baseState("juanita", { piratePowers: true }));
    const mine = getPlayerView(state, 0);
    const other = getPlayerView(state, 1);
    expect(mine.you.peek).toHaveLength(4);
    expect(other.you.peek).toBeNull();
    expect(other.pendingPower).toMatchObject({ seat: 0, pirate: "juanita" });
  });

  it("ハリーはビッドを ±1 できる", () => {
    const state = applyAction(playFirstTrick(baseState("harry", { piratePowers: true })), {
      type: "power",
      seat: 0,
      kind: "bidAdjust",
      delta: 1,
    });
    expect(state.players[0]!.bid).toBe(2);
    expect(state.pendingPower).toBeNull();
  });

  it("他人の能力は操作できない", () => {
    const state = playFirstTrick(baseState("rosie", { piratePowers: true }));
    expect(() =>
      applyAction(state, { type: "power", seat: 1, kind: "lead", leaderSeat: 1 }),
    ).toThrow();
  });

  it("最終トリックではロージーを使えない", () => {
    const state = baseState("rosie", { piratePowers: true });
    state.round = 1;
    state.players[0]!.hand = [special("pirate", "pirate-rosie", "rosie")];
    state.players[1]!.hand = [suit("green", 5)];
    const finished = playFirstTrick(state);
    expect(finished.pendingPower).toBeNull();
    expect(finished.phase).toBe("roundEnd");
  });

  it("ハリーだけは最終トリックでも使える", () => {
    const state = baseState("harry", { piratePowers: true });
    state.round = 1;
    state.players[0]!.hand = [special("pirate", "pirate-harry", "harry")];
    state.players[1]!.hand = [suit("green", 5)];
    const pending = playFirstTrick(state);
    expect(pending.pendingPower).toMatchObject({ pirate: "harry", isFinalTrick: true });
    expect(pending.phase).toBe("playing");

    const done = applyAction(pending, { type: "power", seat: 0, kind: "bidAdjust", delta: -1 });
    expect(done.phase).toBe("roundEnd");
    expect(done.players[0]!.bid).toBe(0);
  });
});
