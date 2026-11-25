import type { ClientMessage, ServerMessage } from "@skulking/protocol";

export type NetStatus = "connecting" | "open" | "closed";

export interface NetHandlers {
  onStatus(status: NetStatus): void;
  onMessage(message: ServerMessage): void;
  onOpen(): void;
}

export interface Net {
  send(message: ClientMessage): void;
  close(): void;
  isOpen(): boolean;
}

export function connect(handlers: NetHandlers): Net {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | null = null;

  const open = (): void => {
    if (closed) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus("open");
      handlers.onOpen();
    });

    ws.addEventListener("message", (event) => {
      try {
        handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // 壊れたメッセージは無視する
      }
    });

    ws.addEventListener("close", () => {
      if (closed) return;
      handlers.onStatus("closed");
      attempt += 1;
      timer = window.setTimeout(open, Math.min(1000 * attempt, 5000));
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  };

  open();

  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    isOpen() {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },
    close() {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      socket?.close();
    },
  };
}
