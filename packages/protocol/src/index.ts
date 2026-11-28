import type { GameOptions, PlayerView, TigressUse } from "@skulking/engine";

export interface LobbySeat {
  seat: number;
  playerId: string;
  name: string;
  bot: boolean;
  connected: boolean;
  /** ラウンド終了画面で「次へ」を押したか。ボットと切断中の席は常に準備完了扱い。 */
  ready: boolean;
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
  | {
      t: "power";
      kind: "skip" | "lead" | "draw" | "discard" | "sideBet" | "peek" | "bidAdjust";
      leaderSeat?: number;
      cardIds?: string[];
      amount?: number;
      delta?: 1 | -1;
    }
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
