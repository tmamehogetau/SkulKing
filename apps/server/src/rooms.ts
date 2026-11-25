import { randomUUID } from "node:crypto";
import {
  DEFAULT_OPTIONS,
  applyAction,
  createGame,
  getPlayerView,
  type Action,
  type GameOptions,
  type GameState,
  type TigressUse,
} from "@skulking/engine";
import type { ServerMessage } from "@skulking/protocol";
import { chooseBid, chooseCard } from "./bots.ts";

export const MAX_SEATS = 6;
const ROOM_IDLE_MS = 1000 * 60 * 60 * 3;

export interface Connection {
  send(message: ServerMessage): void;
}

export interface Seat {
  playerId: string;
  name: string;
  token: string;
  bot: boolean;
  conn: Connection | null;
}

export class RoomError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class Room {
  readonly code: string;
  readonly seats: (Seat | null)[] = Array.from({ length: MAX_SEATS }, () => null);
  state: GameState | null = null;
  options: GameOptions = { ...DEFAULT_OPTIONS };
  hostSeat = 0;
  lastActivity = Date.now();
  private versionBase = 0;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  setOptions(patch: Partial<GameOptions>): void {
    if (this.started) throw new RoomError("already_started", "対戦中は設定を変えられません");
    const next: GameOptions = { ...this.options };
    for (const key of ["includeKraken", "includeWhiteWhale", "includeLoot"] as const) {
      const value = patch[key];
      if (typeof value === "boolean") next[key] = value;
    }
    this.options = next;
    this.lastActivity = Date.now();
  }

  players(): { seat: number; seatInfo: Seat }[] {
    return this.seats.flatMap((seatInfo, seat) =>
      seatInfo ? [{ seat, seatInfo }] : [],
    );
  }

  get started(): boolean {
    return this.state !== null;
  }

  takeSeat(name: string): { seat: number; seatInfo: Seat } {
    const index = this.seats.findIndex((s) => s === null);
    if (index < 0) throw new RoomError("room_full", "この部屋は満員です");
    const seatInfo: Seat = {
      playerId: randomUUID(),
      name,
      token: randomUUID(),
      bot: false,
      conn: null,
    };
    this.seats[index] = seatInfo;
    if (this.players().length === 1) this.hostSeat = index;
    return { seat: index, seatInfo };
  }

  addBot(): number {
    if (this.started) throw new RoomError("already_started", "対戦開始後はボットを追加できません");
    const index = this.seats.findIndex((s) => s === null);
    if (index < 0) throw new RoomError("room_full", "この部屋は満員です");
    this.seats[index] = {
      playerId: `bot-${randomUUID()}`,
      name: `ボット${index + 1}`,
      token: randomUUID(),
      bot: true,
      conn: null,
    };
    return index;
  }

  removeSeat(seat: number): void {
    const seatInfo = this.seats[seat];
    if (!seatInfo) throw new RoomError("no_such_seat", "その席には誰もいません");
    if (this.started) throw new RoomError("already_started", "対戦開始後は席を削除できません");
    if (this.players().length <= 1 && !seatInfo.bot) {
      throw new RoomError("last_player", "最後の 1 人は退出できません");
    }
    this.seats[seat] = null;
    if (this.hostSeat === seat) {
      const next = this.players()[0];
      this.hostSeat = next ? next.seat : 0;
    }
  }

  start(seed?: number): void {
    const seated = this.players();
    if (seated.length < 2) throw new RoomError("not_enough_players", "2 人以上で開始できます");
    // 再戦でも版番号が戻らないように、前の対戦の続きから振り直す
    this.versionBase = (this.state?.version ?? -1) + 1;
    this.state = createGame({
      players: seated.map(({ seat, seatInfo }) => ({
        id: seatInfo.playerId,
        name: seatInfo.name,
        seat,
      })),
      seed: seed ?? Math.floor(Math.random() * 0x7fffffff),
      options: this.options,
      version: this.versionBase,
    });
    this.lastActivity = Date.now();
    this.scheduleBot();
  }

  act(action: Action): void {
    if (!this.state) throw new RoomError("not_started", "まだ対戦が始まっていません");
    this.state = applyAction(this.state, action);
    this.lastActivity = Date.now();
    this.scheduleBot();
    broadcast(this);
  }

  private scheduleBot(): void {
    if (this.botTimer) return;
    const state = this.state;
    if (!state || state.phase === "gameEnd" || state.phase === "roundEnd") return;
    const seatInfo = this.seats[state.turnSeat];
    if (!seatInfo?.bot) return;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const current = this.state;
      if (!current || current.phase === "gameEnd") return;
      const seat = current.turnSeat;
      try {
        if (current.phase === "bidding") {
          this.act({ type: "bid", seat, bid: chooseBid(current, seat) });
        } else if (current.phase === "playing") {
          const pick = chooseCard(current, seat);
          if (!pick) return;
          const action: Action = { type: "playCard", seat, cardId: pick.cardId };
          if (pick.tigressAs) action.tigressAs = pick.tigressAs as TigressUse;
          this.act(action);
        }
      } catch (error) {
        console.error("bot action failed", error);
      }
    }, 700);
  }

  dispose(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

export function lobbyMessage(room: Room): ServerMessage {
  return {
    t: "lobby",
    code: room.code,
    started: room.started,
    hostSeat: room.hostSeat,
    options: room.options,
    seats: room.players().map(({ seat, seatInfo }) => ({
      seat,
      playerId: seatInfo.playerId,
      name: seatInfo.name,
      bot: seatInfo.bot,
      connected: seatInfo.bot || seatInfo.conn !== null,
    })),
  };
}

export function broadcast(room: Room): void {
  const lobby = lobbyMessage(room);
  for (const { seat, seatInfo } of room.players()) {
    if (!seatInfo.conn) continue;
    seatInfo.conn.send(lobby);
    if (room.state) {
      seatInfo.conn.send({ t: "state", view: getPlayerView(room.state, seat) });
    }
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(): Room {
    let code = newCode();
    while (this.rooms.has(code)) code = newCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | null {
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  getOrCreate(code?: string): Room {
    if (!code) return this.create();
    const existing = this.get(code);
    if (!existing) throw new RoomError("room_not_found", "そのルームコードは見つかりません");
    return existing;
  }

  remove(code: string): void {
    const room = this.rooms.get(code);
    room?.dispose();
    this.rooms.delete(code);
  }

  sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const alive = room.players().some(({ seatInfo }) => seatInfo.conn !== null);
      if (!alive && now - room.lastActivity > ROOM_IDLE_MS) this.remove(code);
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
