import { buildDeck, type Card } from "./cards.js";
import { nextInt, shuffleInPlace } from "./random.js";
import { scoreRound } from "./scoring.js";
import { legalPlays, resolveTrick } from "./trick.js";
import {
  DEFAULT_OPTIONS,
  GameError,
  type Action,
  type GameOptions,
  type GameState,
  type PlayedCard,
  type PlayerState,
  type Trick,
  type TrickBonus,
} from "./types.js";

export interface PlayerSeed {
  id?: string;
  name: string;
  /** 省略時は配列順。部屋の席番号に穴があってもよい。 */
  seat?: number;
}

export interface CreateGameInput {
  players: PlayerSeed[];
  seed?: number;
  options?: Partial<GameOptions>;
  /** 第 1 ラウンドのリード席。省略時は乱数。 */
  firstLeaderSeat?: number;
  /** 状態の版番号の初期値。再戦で単調増加させるために部屋側が指定する。 */
  version?: number;
}

export function nextSeat(state: GameState, seat: number): number {
  const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
  const index = seats.indexOf(seat);
  const next = seats[(index + 1) % seats.length];
  if (next === undefined) throw new GameError("no_such_seat", `席 ${seat} が見つかりません`);
  return next;
}

function playerAt(state: GameState, seat: number): PlayerState {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) throw new GameError("no_such_seat", `席 ${seat} が見つかりません`);
  return player;
}

function newTrick(index: number, leaderSeat: number): Trick {
  return {
    index,
    leaderSeat,
    plays: [],
    leadSuit: null,
    resolved: false,
    winnerSeat: null,
    discarded: false,
    nextLeaderSeat: null,
    bonuses: [],
  };
}

function dealRound(state: GameState): void {
  const deck = shuffleInPlace(buildDeck(state.options), state);
  for (const player of state.players) {
    player.hand = deck.splice(0, state.round);
  }
  state.deck = deck;
}

export function createGame(input: CreateGameInput): GameState {
  const count = input.players.length;
  if (count < 2 || count > 6) {
    throw new GameError("player_count", "プレイ人数は 2〜6 人です");
  }

  const options: GameOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const seed = input.seed ?? 1;

  const seats = input.players.map((player, index) => player.seat ?? index);
  if (new Set(seats).size !== seats.length) {
    throw new GameError("duplicate_seat", "席番号が重複しています");
  }

  const state: GameState = {
    seed,
    rng: seed >>> 0 || 1,
    version: input.version ?? 0,
    options,
    players: input.players
      .map((p, index) => ({
        id: p.id ?? `p${(seats[index] ?? index) + 1}`,
        name: p.name,
        seat: seats[index] ?? index,
        hand: [],
        bid: null,
        tricksWon: 0,
        score: 0,
      }))
      .sort((a, b) => a.seat - b.seat),
    round: 1,
    phase: "bidding",
    leaderSeat: 0,
    turnSeat: 0,
    deck: [],
    discardPile: [],
    tricks: [],
    current: null,
    pendingPower: null,
    sideBets: [],
    roundHistory: [],
    lastRound: null,
    winnerSeats: [],
  };

  const leader =
    input.firstLeaderSeat !== undefined && seats.includes(input.firstLeaderSeat)
      ? input.firstLeaderSeat
      : (state.players[nextInt(state, count)]?.seat ?? 0);
  state.leaderSeat = leader;
  state.turnSeat = leader;

  dealRound(state);
  return state;
}

function finishRound(state: GameState): void {
  const bonuses: TrickBonus[] = state.tricks.flatMap((trick) => {
    const entries: TrickBonus[] = [...trick.bonuses];
    if (trick.winnerSeat !== null) {
      for (const play of trick.plays) {
        if (play.card.kind === "loot") {
          entries.push({
            to: trick.winnerSeat,
            points: 20,
            reason: "lootAlliance",
            requiresSeat: play.seat,
          });
        }
      }
    }
    return entries;
  });
  const summary = scoreRound({
    round: state.round,
    players: state.players.map((p) => ({
      seat: p.seat,
      bid: p.bid,
      tricksWon: p.tricksWon,
      score: p.score,
    })),
    bonuses,
    sideBets: state.sideBets,
  });

  for (const row of summary.players) {
    playerAt(state, row.seat).score = row.scoreAfter;
  }

  state.lastRound = summary;
  state.roundHistory.push(summary);
  state.phase = "roundEnd";
}

function computeWinners(state: GameState): number[] {
  const best = Math.max(...state.players.map((p) => p.score));
  return state.players.filter((p) => p.score === best).map((p) => p.seat);
}

/**
 * アクションを適用した新しい状態を返す。元の状態は変更しない。
 * 不正なアクションは GameError を投げる。
 */
export function applyAction(state: GameState, action: Action): GameState {
  const next = structuredClone(state);
  next.version = state.version + 1;

  switch (action.type) {
    case "bid": {
      if (next.phase !== "bidding") {
        throw new GameError("phase", "今はビッドのタイミングではありません");
      }
      if (action.seat !== next.turnSeat) {
        throw new GameError("turn", "あなたの番ではありません");
      }
      if (
        !Number.isInteger(action.bid) ||
        action.bid < 0 ||
        action.bid > next.round
      ) {
        throw new GameError("bid_range", `ビッドは 0〜${next.round} で指定してください`);
      }

      const player = playerAt(next, action.seat);
      player.bid = action.bid;
      next.turnSeat = nextSeat(next, action.seat);

      if (next.players.every((p) => p.bid !== null)) {
        next.phase = "playing";
        next.turnSeat = next.leaderSeat;
        next.current = newTrick(1, next.leaderSeat);
      }
      return next;
    }

    case "playCard": {
      if (next.pendingPower) {
        throw new GameError("pending_power", "先に海賊の能力を決めてください");
      }
      if (next.phase !== "playing" || !next.current) {
        throw new GameError("phase", "今はカードを出すタイミングではありません");
      }
      if (action.seat !== next.turnSeat) {
        throw new GameError("turn", "あなたの番ではありません");
      }

      const player = playerAt(next, action.seat);
      const handIndex = player.hand.findIndex((c) => c.id === action.cardId);
      if (handIndex < 0) {
        throw new GameError("card_not_in_hand", "そのカードは手札にありません");
      }
      const card = player.hand[handIndex] as Card;

      if (card.kind === "tigress" && !action.tigressAs) {
        throw new GameError("tigress_choice", "ティグレスは海賊か逃走かを選んでください");
      }

      const legal = legalPlays(player.hand, next.current).some(
        (option) =>
          option.cardId === card.id &&
          (card.kind !== "tigress" || option.tigressAs === action.tigressAs),
      );
      if (!legal) {
        throw new GameError("illegal_play", "リードの色を持っているので、その色を出してください");
      }

      player.hand.splice(handIndex, 1);
      const play: PlayedCard = { seat: action.seat, card };
      if (card.kind === "tigress" && action.tigressAs) play.tigressAs = action.tigressAs;
      next.current.plays.push(play);

      if (next.current.leadSuit === null && card.kind === "suit") {
        next.current.leadSuit = card.suit;
      }

      if (next.current.plays.length === next.players.length) {
        const trick = next.current;
        const result = resolveTrick(trick.plays, trick.leadSuit);
        trick.resolved = true;
        trick.winnerSeat = result.winnerSeat;
        trick.discarded = result.discarded;
        trick.bonuses = result.bonuses;
        trick.nextLeaderSeat = result.nextLeaderSeat;

        if (result.winnerSeat !== null) {
          playerAt(next, result.winnerSeat).tricksWon += 1;
        }

        next.tricks.push(trick);
        next.current = null;

        const isFinalTrick = next.tricks.length >= next.round;
        const winnerPlay =
          result.winnerSeat !== null
            ? trick.plays.find((play) => play.seat === result.winnerSeat)
            : undefined;
        const pirate =
          winnerPlay && winnerPlay.card.kind === "pirate" ? winnerPlay.card.pirate : undefined;

        // 海賊で取ったら、次のトリックの前に能力を選ぶ（ハリーだけは最終トリックも可）
        if (pirate && next.options.piratePowers && (!isFinalTrick || pirate === "harry")) {
          next.pendingPower = {
            seat: result.winnerSeat as number,
            pirate,
            step: "choose",
            isFinalTrick,
          };
          next.turnSeat = result.winnerSeat as number;
          return next;
        }

        if (isFinalTrick) {
          finishRound(next);
        } else {
          next.turnSeat = result.nextLeaderSeat;
          next.current = newTrick(next.tricks.length + 1, result.nextLeaderSeat);
        }
      } else {
        next.turnSeat = nextSeat(next, action.seat);
      }
      return next;
    }

    case "power": {
      const pending = next.pendingPower;
      if (!pending) {
        throw new GameError("no_power", "能力を使う場面ではありません");
      }
      if (action.seat !== pending.seat) {
        throw new GameError("turn", "あなたの能力ではありません");
      }

      const player = playerAt(next, pending.seat);
      const lastTrick = next.tricks[next.tricks.length - 1];
      const defaultLeader = lastTrick?.nextLeaderSeat ?? next.turnSeat;

      const complete = (leaderSeat: number): GameState => {
        next.pendingPower = null;
        if (pending.isFinalTrick) {
          finishRound(next);
          return next;
        }
        next.turnSeat = leaderSeat;
        next.current = newTrick(next.tricks.length + 1, leaderSeat);
        return next;
      };

      switch (action.kind) {
        case "skip":
          return complete(defaultLeader);

        case "lead": {
          if (pending.pirate !== "rosie") {
            throw new GameError("wrong_power", "ロージーの能力ではありません");
          }
          if (!next.players.some((p) => p.seat === action.leaderSeat)) {
            throw new GameError("no_such_seat", "その席はありません");
          }
          return complete(action.leaderSeat);
        }

        case "draw": {
          if (pending.pirate !== "bendt") {
            throw new GameError("wrong_power", "ベントの能力ではありません");
          }
          if (pending.step !== "choose") {
            throw new GameError("power_step", "すでに引いています");
          }
          const drawn = next.deck.splice(0, 2);
          player.hand.push(...drawn);
          next.pendingPower = { ...pending, step: "discard" };
          return next;
        }

        case "discard": {
          if (pending.pirate !== "bendt" || pending.step !== "discard") {
            throw new GameError("power_step", "先に山札から引いてください");
          }
          if (action.cardIds.length !== 2) {
            throw new GameError("discard_count", "手札から 2 枚選んでください");
          }
          const unique = new Set(action.cardIds);
          if (unique.size !== 2) {
            throw new GameError("discard_count", "同じカードは 2 回選べません");
          }
          for (const cardId of action.cardIds) {
            const index = player.hand.findIndex((card) => card.id === cardId);
            if (index < 0) {
              throw new GameError("card_not_in_hand", "そのカードは手札にありません");
            }
            const removed = player.hand.splice(index, 1)[0];
            if (removed) next.discardPile.push(removed);
          }
          return complete(defaultLeader);
        }

        case "sideBet": {
          if (pending.pirate !== "rascal") {
            throw new GameError("wrong_power", "ラスカルの能力ではありません");
          }
          if (![0, 10, 20].includes(action.amount)) {
            throw new GameError("side_bet", "サイドベットは 0・10・20 から選んでください");
          }
          next.sideBets = next.sideBets.filter((bet) => bet.seat !== pending.seat);
          if (action.amount > 0) {
            next.sideBets.push({ seat: pending.seat, amount: action.amount });
          }
          return complete(defaultLeader);
        }

        case "peek":
          if (pending.pirate !== "juanita") {
            throw new GameError("wrong_power", "ファニータの能力ではありません");
          }
          return complete(defaultLeader);

        case "bidAdjust": {
          if (pending.pirate !== "harry") {
            throw new GameError("wrong_power", "ハリーの能力ではありません");
          }
          const current = player.bid ?? 0;
          player.bid = Math.max(0, Math.min(next.round, current + action.delta));
          return complete(defaultLeader);
        }

        default: {
          const exhaustive: never = action;
          throw new GameError("unknown_action", `未知のアクション: ${String(exhaustive)}`);
        }
      }
    }

    case "nextRound": {
      if (next.phase !== "roundEnd") {
        throw new GameError("phase", "ラウンドはまだ終わっていません");
      }
      if (next.round >= next.options.totalRounds) {
        next.phase = "gameEnd";
        next.winnerSeats = computeWinners(next);
        return next;
      }

      next.round += 1;
      next.tricks = [];
      next.current = null;
      next.pendingPower = null;
      next.sideBets = [];
      next.discardPile = [];
      next.lastRound = null;
      next.leaderSeat = nextSeat(next, next.leaderSeat);
      next.turnSeat = next.leaderSeat;
      for (const player of next.players) {
        player.hand = [];
        player.bid = null;
        player.tricksWon = 0;
      }
      dealRound(next);
      next.phase = "bidding";
      return next;
    }

    default: {
      const exhaustive: never = action;
      throw new GameError("unknown_action", `未知のアクション: ${String(exhaustive)}`);
    }
  }
}

