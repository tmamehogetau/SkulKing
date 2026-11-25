import type { GameOptions, PlayerView, TigressUse } from "@skulking/engine";

export interface LobbySeat {
  seat: number;
  playerId: string;
  name: string;
  bot: boolean;
  connected: boolean;
}

export type ClientMessage =
  | { t: "hello"; name: string; code?: string }
  | { t: "resume"; code: string; playerId: string; token: string }
  | { t: "addBot" }
  | { t: "removeBot"; seat: number }
  | { t: "setOptions"; options: Partial<GameOptions> }
  | { t: "start" }
  | { t: "bid"; bid: number }
  | { t: "play"; cardId: string; tigressAs?: TigressUse }
  | { t: "nextRound" }
  | { t: "leave" };

export type ServerMessage =
  | { t: "welcome"; code: string; playerId: string; token: string; seat: number }
  | {
      t: "lobby";
      code: string;
      started: boolean;
      hostSeat: number;
      options: GameOptions;
      seats: LobbySeat[];
    }
  | { t: "state"; view: PlayerView }
  | { t: "error"; code: string; message: string };
