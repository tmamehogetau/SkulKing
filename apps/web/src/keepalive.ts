const KEEPALIVE_MS = 5 * 60 * 1000;
const ENDPOINT = "/api/keepalive";

function ping(): void {
  if (document.visibilityState !== "visible") return;
  try {
    void fetch(ENDPOINT, { cache: "no-store", keepalive: true }).catch(() => {});
  } catch {
    // 通信できない環境でもゲームの進行は止めない
  }
}

/**
 * Render の無料プランは無通信が 15 分続くとスリープする。
 * 画面を開いている間だけ 5 分おきに叩いて、対戦中に落ちないようにする。
 * タブが見えていない間は止める（誰も見ていない時に無料枠を消費しないため）。
 */
export function startKeepAlive(intervalMs = KEEPALIVE_MS): () => void {
  let timer: number | null = null;

  const stop = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  const start = (): void => {
    stop();
    ping();
    timer = window.setInterval(ping, intervalMs);
  };

  const onVisibility = (): void => {
    if (document.visibilityState === "visible") start();
    else stop();
  };

  if (document.visibilityState === "visible") start();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", ping);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", ping);
  };
}
