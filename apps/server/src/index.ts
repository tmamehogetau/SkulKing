import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { GameError } from "@skulking/engine";
import type { ClientMessage, ServerMessage } from "@skulking/protocol";
import {
  RoomError,
  RoomManager,
  broadcast,
  type Connection,
  type Room,
} from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 8123);
const WEB_DIST = resolve(import.meta.dirname, "../../web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const rooms = new RoomManager();

function sanitizeName(input: unknown): string {
  if (typeof input !== "string") return "プレイヤー";
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 12);
  return cleaned.length > 0 ? cleaned : "プレイヤー";
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(WEB_DIST, "." + rel);
  if (!filePath.startsWith(WEB_DIST + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<h1>ビルドが見つかりません</h1><p><code>npm run build</code> を実行してから開き直してください。</p>",
    );
  }
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  void serveStatic(decodeURIComponent(url.pathname), res);
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

interface Session {
  room: Room;
  seat: number;
}

wss.on("connection", (ws: WebSocket) => {
  let session: Session | null = null;

  const send = (message: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const connection: Connection = { send };

  const fail = (code: string, message: string): void => {
    send({ t: "error", code, message });
  };

  const requireSession = (): Session => {
    if (!session) throw new RoomError("no_session", "先に部屋へ入ってください");
    return session;
  };

  const handle = (message: ClientMessage): void => {
    switch (message.t) {
      case "hello": {
        if (session) throw new RoomError("already_joined", "すでに部屋に入っています");
        const room = message.code ? rooms.getOrCreate(message.code) : rooms.create();
        if (room.started) {
          throw new RoomError("already_started", "この部屋はすでに対戦中です");
        }
        const { seat, seatInfo } = room.takeSeat(sanitizeName(message.name));
        seatInfo.conn = connection;
        room.lastActivity = Date.now();
        session = { room, seat };
        send({
          t: "welcome",
          code: room.code,
          playerId: seatInfo.playerId,
          token: seatInfo.token,
          seat,
        });
        broadcast(room);
        return;
      }

      case "resume": {
        if (session) throw new RoomError("already_joined", "すでに部屋に入っています");
        const room = rooms.get(message.code);
        if (!room) throw new RoomError("room_not_found", "そのルームは残っていません");
        const seatIndex = room.seats.findIndex(
          (s) => s !== null && s.playerId === message.playerId && s.token === message.token,
        );
        if (seatIndex < 0) throw new RoomError("bad_token", "この部屋には戻れません");
        const seatInfo = room.seats[seatIndex];
        if (!seatInfo) throw new RoomError("bad_token", "この部屋には戻れません");
        seatInfo.conn = connection;
        room.lastActivity = Date.now();
        session = { room, seat: seatIndex };
        send({
          t: "welcome",
          code: room.code,
          playerId: seatInfo.playerId,
          token: seatInfo.token,
          seat: seatIndex,
        });
        broadcast(room);
        room.refreshReady();
        return;
      }

      case "addBot": {
        const { room } = requireSession();
        room.addBot();
        broadcast(room);
        return;
      }

      case "removeBot": {
        const { room } = requireSession();
        const seatInfo = room.seats[message.seat];
        if (!seatInfo || !seatInfo.bot) throw new RoomError("not_a_bot", "ボットの席ではありません");
        room.removeSeat(message.seat);
        broadcast(room);
        return;
      }

      case "setOptions": {
        const { room, seat } = requireSession();
        if (room.hostSeat !== seat) {
          throw new RoomError("not_host", "設定を変えられるのは部屋主だけです");
        }
        room.setOptions(message.options);
        broadcast(room);
        return;
      }

      case "start": {
        const { room, seat } = requireSession();
        if (room.started && room.state?.phase !== "gameEnd") {
          throw new RoomError("already_started", "すでに対戦中です");
        }
        if (room.hostSeat !== seat) throw new RoomError("not_host", "開始できるのは部屋主だけです");
        room.start();
        broadcast(room);
        return;
      }

      case "bid": {
        const { room, seat } = requireSession();
        room.act({ type: "bid", seat, bid: message.bid });
        return;
      }

      case "play": {
        const { room, seat } = requireSession();
        room.act({
          type: "playCard",
          seat,
          cardId: message.cardId,
          ...(message.tigressAs ? { tigressAs: message.tigressAs } : {}),
        });
        return;
      }

      case "nextRound": {
        const { room, seat } = requireSession();
        room.markReady(seat);
        return;
      }

      case "leave": {
        if (!session) return;
        const { room, seat } = session;
        const seatInfo = room.seats[seat];
        session = null;

        if (seatInfo && !room.started) {
          // 人間が自分だけなら部屋ごと閉じる（最後の 1 人が詰まないように）
          const humans = room.players().filter(({ seatInfo: s }) => !s.bot);
          if (humans.length <= 1) {
            rooms.remove(room.code);
            return;
          }
          room.removeSeat(seat);
          broadcast(room);
          return;
        }

        if (seatInfo) {
          seatInfo.conn = null;
          broadcast(room);
          // 抜けた人を待たずに済むよう、残りの準備状況を見直す
          room.refreshReady();
        }
        if (room.players().every(({ seatInfo: s }) => s.conn === null)) rooms.remove(room.code);
        return;
      }

      default: {
        throw new RoomError("unknown_message", "不明なメッセージです");
      }
    }
  };

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      fail("bad_json", "メッセージを解釈できませんでした");
      return;
    }
    try {
      handle(message);
    } catch (error) {
      if (error instanceof RoomError) {
        fail(error.code, error.message);
      } else if (error instanceof GameError) {
        // ルール上の拒否はプレイヤーに理由を返す。状態は変わっていない。
        fail(error.code, error.message);
      } else {
        console.error("unhandled action error", error);
        fail("internal", "サーバー内部エラーが起きました");
      }
    }
  });

  ws.on("close", () => {
    if (!session) return;
    const { room, seat } = session;
    const seatInfo = room.seats[seat];
    if (seatInfo?.conn === connection) {
      seatInfo.conn = null;
      room.lastActivity = Date.now();
      broadcast(room);
      // ラウンド終了画面で待っている最中に抜けたら、残りの人だけで進める
      room.refreshReady();
    }
    session = null;
  });
});

setInterval(() => rooms.sweep(), 60_000).unref();

httpServer.listen(PORT, () => {
  console.log(`Skull King server: http://localhost:${PORT}`);
});
