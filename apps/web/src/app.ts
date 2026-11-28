import htmImport from "htm";
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  BonusReason,
  Card as GameCard,
  PlayerView,
  RoundSummary,
  Suit,
  TigressUse,
  TrickBonus,
} from "@skulking/engine";
import type { ClientMessage, ServerMessage } from "@skulking/protocol";
import { artOf, faceOf, sortHand, SUIT_LABEL } from "./cards.js";
import { startKeepAlive } from "./keepalive.js";
import { connect, type Net, type NetStatus } from "./net.js";
import { loadMuted, playSound, saveMuted, unlockAudio } from "./sound.js";

// htm のテンプレートは VNode を返すが、型は緩く扱う（HTML 断片をそのまま h に渡すため）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Template = (strings: TemplateStringsArray, ...values: unknown[]) => any;
const html = (htmImport as unknown as { bind(h: unknown): Template }).bind(h);

interface Session {
  code: string;
  playerId: string;
  token: string;
  seat: number;
}

type LobbyMessage = Extract<ServerMessage, { t: "lobby" }>;
type PublicPlayer = PlayerView["players"][number];

const SESSION_KEY = "skulking.session.v1";
const NAME_KEY = "skulking.name.v1";

const EXPANSION_OPTIONS: {
  key: "includeKraken" | "includeWhiteWhale" | "includeLoot";
  label: string;
  description: string;
}[] = [
  {
    key: "includeKraken",
    label: "クラーケン",
    description: "出たトリックは流れ、誰も取りません",
  },
  {
    key: "includeWhiteWhale",
    label: "白クジラ",
    description: "特殊カードが勝てなくなり、色の数字で決まります",
  },
  {
    key: "includeLoot",
    label: "略奪品",
    description: "取った人と出した人が両方ビッドを当てると +20",
  },
];

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.playerId !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.seat !== "number"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function loadName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

function turnText(view: PlayerView, busy: boolean): string {
  if (busy) return "送信中…";
  const name = view.players.find((player) => player.seat === view.turnSeat)?.name ?? "他の人";
  if (view.phase === "bidding") {
    return view.you.canAct ? "ビッドを宣言してください" : `${name} のビッド待ち`;
  }
  if (view.phase === "playing") {
    return view.you.canAct ? "カードを選んでください" : `${name} の番です`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// ルート
// ---------------------------------------------------------------------------

export function App() {
  const [status, setStatus] = useState<NetStatus>("connecting");
  const [session, setSession] = useState<Session | null>(loadSession);
  const [lobby, setLobby] = useState<LobbyMessage | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 対戦から離れた状態。トークンは残すので「戻る」で同じ席に復帰できる。 */
  const [detached, setDetached] = useState(false);
  const [muted, setMuted] = useState<boolean>(loadMuted);
  const [netKey, setNetKey] = useState(0);
  const netRef = useRef<Net | null>(null);
  const sessionRef = useRef<Session | null>(session);
  /** 接続が閉じている間に入力されたメッセージを、再接続時に送る。 */
  const pendingRef = useRef<ClientMessage | null>(null);

  const toggleMute = (): void => {
    setMuted((prev) => {
      const next = !prev;
      saveMuted(next);
      if (!next) {
        unlockAudio();
        playSound("bid", false);
      }
      return next;
    });
  };

  useEffect(() => {
    const onFirstInput = (): void => unlockAudio();
    window.addEventListener("pointerdown", onFirstInput, { passive: true });
    window.addEventListener("keydown", onFirstInput);
    return () => {
      window.removeEventListener("pointerdown", onFirstInput);
      window.removeEventListener("keydown", onFirstInput);
    };
  }, []);

  // 画面を開いている間だけ、無料プランのアイドルスリープを避ける
  useEffect(() => startKeepAlive(), []);

  useEffect(() => {
    setStatus("connecting");
    const net = connect({
      onStatus: (next) => {
        if (netRef.current === net) setStatus(next);
      },
      onOpen: () => {
        if (netRef.current !== net) return;
        const pending = pendingRef.current;
        if (pending) {
          pendingRef.current = null;
          net.send(pending);
          return;
        }
        const stored = sessionRef.current;
        if (stored) {
          net.send({
            t: "resume",
            code: stored.code,
            playerId: stored.playerId,
            token: stored.token,
          });
        }
      },
      onMessage: (message) => {
        // 閉じた接続から遅れて届いたメッセージは捨てる
        if (netRef.current !== net) return;
        if (message.t === "welcome") {
          const next: Session = {
            code: message.code,
            playerId: message.playerId,
            token: message.token,
            seat: message.seat,
          };
          sessionRef.current = next;
          saveSession(next);
          setSession(next);
          setError(null);
          return;
        }
        if (message.t === "lobby") {
          setLobby(message);
          return;
        }
        if (message.t === "state") {
          // 古いビューが遅れて届いたら捨てる（再接続直後の取り違え防止）
          setView((previous) =>
            previous && previous.version > message.view.version ? previous : message.view,
          );
          return;
        }
        setError(message.message);
        if (
          message.code === "room_not_found" ||
          message.code === "bad_token" ||
          message.code === "already_started"
        ) {
          sessionRef.current = null;
          saveSession(null);
          setSession(null);
          setLobby(null);
          setView(null);
        }
      },
    });
    netRef.current = net;
    return () => {
      if (netRef.current === net) netRef.current = null;
      net.close();
    };
  }, [netKey]);

  const send = (message: ClientMessage): void => {
    netRef.current?.send(message);
  };

  /** 切断中でも送れるように、開いていなければ再接続してから送る。 */
  const dispatch = (message: ClientMessage): void => {
    const net = netRef.current;
    if (net?.isOpen()) {
      net.send(message);
      return;
    }
    pendingRef.current = message;
    setNetKey((key) => key + 1);
  };

  const leave = (): void => {
    if (view) {
      // 対戦中は席とトークンを残したまま切断するだけにして、あとで戻れるようにする
      const net = netRef.current;
      netRef.current = null;
      net?.close();
      setView(null);
      setLobby(null);
      setDetached(true);
      return;
    }
    send({ t: "leave" });
    sessionRef.current = null;
    saveSession(null);
    setSession(null);
    setLobby(null);
    setView(null);
  };

  const resume = (): void => {
    setDetached(false);
    setNetKey((key) => key + 1);
  };

  const dropSession = (): void => {
    sessionRef.current = null;
    saveSession(null);
    setSession(null);
    setLobby(null);
    setView(null);
    setDetached(false);
  };

  const createRoom = (name: string): void => {
    saveName(name);
    dropSession();
    dispatch({ t: "hello", name });
  };

  const joinRoom = (name: string, code: string): void => {
    saveName(name);
    dropSession();
    dispatch({ t: "hello", name, code: code.toUpperCase() });
  };

  return html`
    <div class="app">
      ${status === "connecting" && html`<div class="banner">サーバーに接続中…</div>`}
      ${status === "closed" && html`<div class="banner">接続が切れました。再接続しています…</div>`}
      ${error && html`<div class="toast" onClick=${() => setError(null)}>${error}</div>`}
      ${!session || detached
        ? html`<${Home}
            status=${status}
            initialName=${loadName()}
            resumable=${detached ? session : null}
            muted=${muted}
            onToggleMute=${toggleMute}
            onCreate=${createRoom}
            onJoin=${joinRoom}
            onResume=${resume}
          />`
        : view
          ? html`<${Table}
              view=${view}
              lobby=${lobby}
              session=${session}
              muted=${muted}
              onToggleMute=${toggleMute}
              send=${send}
              onLeave=${leave}
            />`
          : html`<${LobbyScreen}
              lobby=${lobby}
              session=${session}
              send=${send}
              onLeave=${leave}
            />`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// ホーム
// ---------------------------------------------------------------------------

function Home(props: {
  status: NetStatus;
  initialName: string;
  resumable: Session | null;
  muted: boolean;
  onToggleMute: () => void;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onResume: () => void;
}) {
  const [name, setName] = useState(props.initialName);
  const [code, setCode] = useState("");
  const [showRules, setShowRules] = useState(false);
  const ready = props.status === "open" && name.trim().length > 0;

  return html`
    <div class="home">
      <div class="hero">
        <img src="/assets/hero.webp" alt="" draggable="false" />
        <div class="hero-text">
          <h1 class="title">スカルキング</h1>
          <p class="subtitle">
            七つの海を賭けた 10 ラウンド。ビッドを当てた者だけが宝を掴む。
          </p>
        </div>
      </div>

      ${props.resumable &&
      html`<div class="resume-card">
        <div>
          <div class="resume-title">航行中の対戦があります</div>
          <div class="resume-sub">ルーム ${props.resumable.code}・同じ席に戻れます</div>
        </div>
        <button class="primary" onClick=${props.onResume}>戻る</button>
      </div>`}

      <div class="field">
        <label>船員名</label>
        <input
          value=${name}
          maxlength="12"
          placeholder="ロジャー"
          onInput=${(event: Event) => setName((event.target as HTMLInputElement).value)}
        />
      </div>
      <button class="primary" disabled=${!ready} onClick=${() => props.onCreate(name.trim())}>
        部屋を作る
      </button>
      <div class="field">
        <label>ルームコードで参加</label>
        <div class="row">
          <input
            class="code-input"
            value=${code}
            maxlength="4"
            placeholder="4文字のコード"
            onInput=${(event: Event) =>
              setCode((event.target as HTMLInputElement).value.toUpperCase())}
          />
          <button
            disabled=${!ready || code.trim().length !== 4}
            onClick=${() => props.onJoin(name.trim(), code.trim())}
          >
            参加
          </button>
        </div>
      </div>
      ${props.status !== "open" && html`<p class="hint">サーバーに接続中…</p>`}
      <p class="home-links">
        <button class="link-btn" onClick=${() => setShowRules(true)}>ルールを見る</button>
        <span class="home-links-sep" aria-hidden="true">・</span>
        <button
          class="link-btn"
          aria-pressed=${!props.muted}
          onClick=${props.onToggleMute}
        >
          ${props.muted ? "効果音: OFF" : "効果音: ON"}
        </button>
      </p>
      ${showRules && html`<${RulesOverlay} onClose=${() => setShowRules(false)} />`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// ロビー
// ---------------------------------------------------------------------------

const SEAT_EMBLEMS = ["anchor", "wheel", "compass", "spyglass", "lantern", "cutlass"];

function LobbyScreen(props: {
  lobby: LobbyMessage | null;
  session: Session;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}) {
  const lobby = props.lobby;
  const [copied, setCopied] = useState(false);
  if (!lobby) return html`<p class="hint">部屋を準備しています…</p>`;

  const isHost = lobby.hostSeat === props.session.seat;
  const humans = lobby.seats.filter((seat) => !seat.bot).length;
  // ルームコードは他人に伝えるための文字列なので、一手でコピーできるようにする。
  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードが使えない環境では、選択して Ctrl+C に任せる。
      const range = document.createRange();
      const codeNode = document.querySelector(".code");
      const selection = window.getSelection();
      if (codeNode && selection) {
        range.selectNodeContents(codeNode);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return html`
    <div class="lobby">
      <div class="lobby-head">
        <div class="brand-mark">${SkullGlyph()}</div>
        <div>
          <p class="hint left">ルームコード</p>
          <div class="code-row">
            <div class="code">${lobby.code}</div>
            <button class="copy-btn" onClick=${copyCode}>${copied ? "コピー済み" : "コピー"}</button>
          </div>
          <p class="hint left">
            このコードを船員に伝えてください（${humans} 人乗船中・最大 6 人）
          </p>
        </div>
      </div>

      <div class="seats">
        ${lobby.seats.map(
          (seat) => html`
            <div class="seat" key=${seat.seat}>
              <div class="seat-name">
                <img
                  class="seat-emblem"
                  src=${`/assets/emblems/${SEAT_EMBLEMS[seat.seat % SEAT_EMBLEMS.length]}.webp`}
                  alt=""
                  draggable="false"
                />
                ${seat.name}
                ${seat.seat === props.session.seat && html`<span class="tag">あなた</span>`}
                ${seat.seat === lobby.hostSeat && html`<span class="tag">船長</span>`}
                ${seat.bot && html`<span class="tag">ボット</span>`}
                ${!seat.connected && !seat.bot && html`<span class="tag">切断中</span>`}
              </div>
              ${seat.bot &&
              isHost &&
              html`<button class="ghost" onClick=${() => props.send({ t: "removeBot", seat: seat.seat })}>
                降ろす
              </button>`}
            </div>
          `,
        )}
      </div>

      <div class="settings">
        <div class="settings-title">拡張カード ${isHost ? "" : "（船長が設定）"}</div>
        ${EXPANSION_OPTIONS.map(
          (option) => html`
            <label class=${`check${isHost ? "" : " readonly"}`} key=${option.key}>
              <input
                type="checkbox"
                checked=${lobby.options[option.key]}
                disabled=${!isHost}
                onChange=${() =>
                  props.send({
                    t: "setOptions",
                    options: { [option.key]: !lobby.options[option.key] },
                  })}
              />
              <span>
                <b>${option.label}</b>
                <small>${option.description}</small>
              </span>
            </label>
          `,
        )}
      </div>

      <div class="row">
        <button
          disabled=${lobby.seats.length >= 6}
          onClick=${() => props.send({ t: "addBot" })}
        >
          ボットを乗せる
        </button>
        ${isHost
          ? html`<button
              class="primary"
              disabled=${lobby.seats.length < 2}
              onClick=${() => props.send({ t: "start" })}
            >
              出航する
            </button>`
          : html`<button disabled>船長の出航待ち</button>`}
      </div>
      <button class="ghost" onClick=${props.onLeave}>下船する</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 対戦画面
// ---------------------------------------------------------------------------

function Table(props: {
  view: PlayerView;
  lobby: LobbyMessage | null;
  session: Session;
  muted: boolean;
  onToggleMute: () => void;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}) {
  const { view, send } = props;
  const [tigressCard, setTigressCard] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showScores, setShowScores] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const mutedRef = useRef(props.muted);
  mutedRef.current = props.muted;

  const busy = sentAt !== null && sentAt === view.version;
  const myTurn = view.you.canAct && !busy;

  useEffect(() => {
    setSentAt(null);
    setSelected(null);
  }, [view.version]);

  useEffect(() => {
    if (sentAt === null) return;
    const timer = window.setTimeout(() => setSentAt(null), 2000);
    return () => window.clearTimeout(timer);
  }, [sentAt]);

  useEffect(() => {
    setTigressCard(null);
  }, [view.phase, view.round, view.turnSeat]);

  const act = (message: ClientMessage): void => {
    setSentAt(view.version);
    send(message);
  };

  const optionsByCard = useMemo(() => {
    const map = new Map<string, (TigressUse | null)[]>();
    for (const option of view.you.legalPlays) {
      const list = map.get(option.cardId) ?? [];
      list.push(option.tigressAs ?? null);
      map.set(option.cardId, list);
    }
    return map;
  }, [view.you.legalPlays]);

  const hand = useMemo(() => sortHand(view.you.hand), [view.you.hand]);

  const play = (card: GameCard): void => {
    if (view.phase !== "playing" || !myTurn) return;
    const options = optionsByCard.get(card.id);
    if (!options || options.length === 0) return;
    if (options.length > 1) {
      setTigressCard(card.id);
      return;
    }
    const as = options[0] ?? null;
    act(as ? { t: "play", cardId: card.id, tigressAs: as } : { t: "play", cardId: card.id });
  };

  const bid = (value: number): void => {
    if (view.phase !== "bidding" || !myTurn) return;
    playSound("bid", mutedRef.current);
    act({ t: "bid", bid: value });
  };

  // キーボード操作: 数字でビッド / 手札選択、Enter で出す、Esc で解除
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      setSelected(null);
      setTigressCard(null);
      setShowScores(false);
      setShowRules(false);
      return;
    }
    // 何かのパネルが開いている間は、裏の札を動かさない
    if (showScores || showRules) return;
    if (event.key === "Enter" && selected) {
      const card = hand.find((item) => item.id === selected);
      if (card) play(card);
      setSelected(null);
      return;
    }
    if (!/^[0-9]$/.test(event.key)) return;
    const digit = Number(event.key);

    if (view.phase === "bidding" && myTurn) {
      if (digit <= view.round) bid(digit);
      return;
    }
    if (view.phase === "playing" && myTurn && digit >= 1 && digit <= hand.length) {
      setSelected(hand[digit - 1]?.id ?? null);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const seatInfo = new Map(
    (props.lobby?.seats ?? []).map((seat) => [seat.seat, seat] as const),
  );
  const seats = view.players.map((player) => player.seat).sort((a, b) => a - b);
  const myIndex = seats.indexOf(view.you.seat);
  const turnOrder = [...seats.slice(myIndex + 1), ...seats.slice(0, myIndex)];
  const others = turnOrder.map(
    (seat) => view.players.find((player) => player.seat === seat)!,
  );

  const isHost = props.lobby?.hostSeat === props.session.seat;
  const me = view.players.find((player) => player.seat === view.you.seat);
  const turnPlayer = view.players.find((player) => player.seat === view.turnSeat);
  // そのラウンドで最初に札を出す人。ビッド中だけ前に出す（以降は場のリード表示が担う）。
  const leaderName = view.players.find((player) => player.seat === view.leaderSeat)?.name ?? "?";
  const bidding = view.phase === "bidding";

  // ラウンド開始と自分の手番を、短いバナーで知らせる
  const [banner, setBanner] = useState<{ id: number; title: string; sub: string } | null>(null);
  const lastRoundRef = useRef(view.round);
  const lastMyTurnRef = useRef(false);

  // トリックが決まった直後は、結果を少しだけ見せる。
  // 演出が残ったまま次の札を出せると、何が起きたのか分からないまま手が進む。
  const [holding, setHolding] = useState(false);
  const lastTrickCountRef = useRef(view.tricks.length);
  const lastPlayCountRef = useRef(view.currentTrick?.plays.length ?? 0);
  const lastPhaseRef = useRef(view.phase);

  useEffect(() => {
    const count = view.currentTrick?.plays.length ?? 0;
    if (count > lastPlayCountRef.current) {
      playSound("card", mutedRef.current);
    }
    lastPlayCountRef.current = count;
  }, [view.currentTrick?.index, view.currentTrick?.plays.length]);

  useEffect(() => {
    if (view.tricks.length <= lastTrickCountRef.current) {
      lastTrickCountRef.current = view.tricks.length;
      return;
    }
    lastTrickCountRef.current = view.tricks.length;
    const latest = view.tricks[view.tricks.length - 1];
    if (latest) {
      if (latest.discarded) {
        playSound("trickDiscard", mutedRef.current);
      } else if (latest.winnerSeat === view.you.seat) {
        playSound("trickWin", mutedRef.current);
      } else {
        playSound("trickOther", mutedRef.current);
      }
    }
    setHolding(true);
    const timer = window.setTimeout(() => setHolding(false), 1200);
    return () => window.clearTimeout(timer);
  }, [view.tricks.length]);

  useEffect(() => {
    if (view.phase === lastPhaseRef.current) return;
    lastPhaseRef.current = view.phase;
    if (view.phase === "roundEnd") {
      playSound("roundEnd", mutedRef.current);
    } else if (view.phase === "gameEnd") {
      playSound("gameEnd", mutedRef.current);
    }
  }, [view.phase]);

  const lastBannerAtRef = useRef(0);
  const showBanner = (title: string, sub: string): void => {
    // ラウンド開始と手番開始が同時に来たときは、先に出たほうを残す
    if (Date.now() - lastBannerAtRef.current < 900) return;
    lastBannerAtRef.current = Date.now();
    setBanner({ id: Date.now(), title, sub });
  };

  useEffect(() => {
    if (view.round === lastRoundRef.current) return;
    lastRoundRef.current = view.round;
    const lead = view.players.find((player) => player.seat === view.leaderSeat)?.name ?? "?";
    showBanner(`ROUND ${view.round}`, `手札 ${view.round} 枚・最初は ${lead}`);
  }, [view.round]);

  useEffect(() => {
    if (myTurn && !lastMyTurnRef.current) {
      showBanner("あなたの番", view.phase === "bidding" ? "取るトリック数を宣言" : "出すカードを選ぶ");
      playSound("turn", mutedRef.current);
    }
    lastMyTurnRef.current = myTurn;
  }, [myTurn, view.phase, view.round]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 2300);
    return () => window.clearTimeout(timer);
  }, [banner]);

  return html`
    <div class="table-shell">
      ${banner &&
      view.phase !== "roundEnd" &&
      view.phase !== "gameEnd" &&
      html`<div class="phase-banner" key=${banner.id}>
        <span class="phase-title">${banner.title}</span>
        <span class="phase-sub">${banner.sub}</span>
      </div>`}

      <header class="hud">
        <div class="hud-brand">${SkullGlyph()}<span>SKULL KING</span></div>
        <div class="hud-chips">
          <span class="chip chip--room">ROOM ${props.session.code}</span>
          <span class="chip chip--round">ROUND ${view.round}/${view.totalRounds}</span>
        </div>
        <div class="hud-actions">
          <button
            class=${`hud-btn${props.muted ? " is-muted" : ""}`}
            aria-pressed=${!props.muted}
            title=${props.muted ? "効果音をONにする" : "効果音をOFFにする"}
            onClick=${props.onToggleMute}
          >
            ${props.muted ? "音 OFF" : "音 ON"}
          </button>
          <button class="hud-btn" onClick=${() => setShowRules(true)}>ルール</button>
          <button class="hud-btn" onClick=${() => setShowScores(true)}>スコア</button>
        </div>
      </header>

      <section class="board">
        <div class="opponents">
          ${others.map(
            (player) => html`<${OpponentPlate}
              player=${player}
              active=${view.turnSeat === player.seat}
              leader=${bidding && view.leaderSeat === player.seat}
              disconnected=${seatInfo.get(player.seat)?.connected === false}
            />`,
          )}
        </div>

        <${Arena} view=${view} showResolved=${holding}>
          ${view.phase === "bidding" &&
          html`<div class=${`bid-bar${myTurn ? " is-mine" : ""}`}>
            <span class="bid-label">ビッド</span>
            ${Array.from({ length: view.round + 1 }, (_, index) => html`
              <button
                key=${index}
                class="bid-medal-btn"
                disabled=${!myTurn}
                onClick=${() => bid(index)}
              >
                ${index}
              </button>
            `)}
            <p class="bid-hint">
              ${myTurn
                ? "このラウンドで取るトリック数を選んでください"
                : `${turnPlayer?.name ?? "他の人"} のビッド待ち`}
            </p>
            <p class="bid-lead">最初に札を出す人: <b>${leaderName}</b></p>
          </div>`}
        </${Arena}>

        <div class=${`me-zone${myTurn ? " is-active" : ""}${holding ? " is-hold" : ""}`}>
          <div class="me-bar">
            ${myTurn && html`<span class="turn-chip">あなたの番</span>`}
            <span class="me-name">${me?.name ?? "あなた"}<span class="tag">あなた</span>${
              bidding && view.leaderSeat === view.you.seat
                ? html`<span class="tag tag--lead">リード</span>`
                : null
            }</span>
            <span class="me-stat">ビッド <b>${view.you.bid ?? "–"}</b></span>
            <span class="me-stat">取得 <b>${me?.tricksWon ?? 0}</b></span>
            <span class="me-stat">手札 <b>${view.you.hand.length}</b></span>
          </div>

          <p class=${`hand-hint${myTurn ? " is-mine" : ""}`}>${turnText(view, busy)}</p>

          <div class="hand">
            ${hand.map((card, index) => {
              const enabled =
                view.phase === "playing" &&
                myTurn &&
                !holding &&
                (optionsByCard.get(card.id)?.length ?? 0) > 0;
              const mid = (hand.length - 1) / 2;
              const angle = (index - mid) * 2.4;
              return html`<${CardView}
                key=${card.id}
                card=${card}
                size="lg"
                state=${enabled ? "play" : view.phase === "playing" ? "off" : "idle"}
                selected=${selected === card.id}
                style=${`--rot:${angle}deg; --lift:${Math.abs(index - mid) * 3}px`}
                onClick=${() => play(card)}
              />`;
            })}
          </div>
          <p class="key-hint">数字キーで選択・Enter で出す／ビッド中は数字キーで宣言</p>
        </div>
      </section>

      ${tigressCard &&
      html`<div class="overlay">
        <div class="panel">
          <h2>ティグレスをどう出す？</h2>
          <p class="panel-sub">海賊なら色札に勝ち、逃走なら負けます。</p>
          <div class="actions">
            <button class="ghost" onClick=${() => setTigressCard(null)}>やめる</button>
            <button
              onClick=${() => {
                act({ t: "play", cardId: tigressCard, tigressAs: "escape" });
                setTigressCard(null);
              }}
            >
              逃走として出す
            </button>
            <button
              class="primary"
              onClick=${() => {
                act({ t: "play", cardId: tigressCard, tigressAs: "pirate" });
                setTigressCard(null);
              }}
            >
              海賊として出す
            </button>
          </div>
        </div>
      </div>`}
      ${view.phase === "roundEnd" &&
      view.lastRound &&
      html`<${RoundOverlay}
        summary=${view.lastRound}
        view=${view}
        lobby=${props.lobby}
        send=${send}
        onLeave=${props.onLeave}
      />`}
      ${view.phase === "gameEnd" &&
      html`<${GameOverOverlay}
        view=${view}
        send=${send}
        isHost=${isHost}
        onLeave=${props.onLeave}
      />`}
      ${showRules && html`<${RulesOverlay} onClose=${() => setShowRules(false)} />`}
      ${showScores &&
      html`<${Scoreboard} view=${view} onClose=${() => setShowScores(false)} />`}
    </div>
  `;
}

function OpponentPlate(props: {
  player: PublicPlayer;
  active: boolean;
  leader: boolean;
  disconnected: boolean;
}) {
  const backs = Math.min(props.player.handCount, 10);
  const made = props.player.bid !== null && props.player.bid === props.player.tricksWon;
  return html`
    <div class=${`opponent${props.active ? " is-active" : ""}`}>
      <div class="opp-head">
        <span class="opp-who">
          <span class="opp-name">
            <img
              class="seat-emblem opp-emblem"
              src=${`/assets/emblems/${SEAT_EMBLEMS[props.player.seat % SEAT_EMBLEMS.length]}.webp`}
              alt=""
              draggable="false"
            />
            ${props.player.name}
          </span>
          ${props.leader ? html`<span class="tag tag--lead">リード</span>` : null}
          ${props.disconnected ? html`<span class="tag">切断</span>` : null}
        </span>
        <span class="opp-score">${props.player.score}<small>点</small></span>
      </div>
      <div class="opp-stats">
        <span class="opp-stat">
          <b>${props.player.bid ?? "–"}</b>
          <small>ビッド</small>
        </span>
        <span class=${`opp-stat${made ? " is-made" : ""}`}>
          <b>${props.player.tricksWon}</b>
          <small>取得</small>
        </span>
        <span class="opp-backs">
          ${Array.from({ length: backs }, (_, index) => html`<span class="card-back" key=${index} />`)}
        </span>
      </div>
    </div>
  `;
}

function Arena(props: { view: PlayerView; showResolved?: boolean; hideHead?: boolean; children?: unknown }) {
  const { view } = props;
  const current = view.currentTrick;
  const last = view.tricks.length > 0 ? view.tricks[view.tricks.length - 1] ?? null : null;
  // 決まったトリックは、結果の見せ場が終わるまで表示する（showResolved）。
  // 見せ場の最中に次のトリックが始まっても、勝ち札を消さない。
  const shown = props.showResolved && last ? last : current && current.plays.length > 0 ? current : null;
  const nameOf = (seat: number): string =>
    view.players.find((player) => player.seat === seat)?.name ?? `席 ${seat}`;

  if (!shown) {
    const turnName = view.players.find((player) => player.seat === view.turnSeat)?.name ?? "他の人";
    // ビッド中はフェーズ名を出さない。HUD の ROUND 表示とビッドの金貨、
    // 下の案内文で足りているので、同じことを三度言わない。
    const idleLine =
      view.phase === "playing"
        ? view.turnSeat === view.you.seat
          ? "あなたの番です"
          : `${turnName} がカードを選んでいます`
        : view.phase === "bidding"
          ? ""
          : `ラウンド ${view.round}・手札 ${view.round} 枚`;
    return html`
      <div class="arena">
        <div class="arena-idle">
          <div class="arena-idle-mark">${CompassGlyph()}</div>
          ${idleLine ? html`<p>${idleLine}</p>` : null}
        </div>
        ${props.children}
      </div>
    `;
  }

  const plays = (() => {
    const index = shown.plays.findIndex((play) => play.seat === shown.leaderSeat);
    if (index <= 0) return shown.plays;
    return [...shown.plays.slice(index), ...shown.plays.slice(0, index)];
  })();

  const bonus = shown.bonuses.reduce((sum, item) => sum + item.points, 0);
  const winnerName = shown.winnerSeat !== null ? nameOf(shown.winnerSeat) : null;

  return html`
    <div class="arena">
      ${props.hideHead
        ? null
        : html`<div class="arena-head">
            ${shown.leadSuit
              ? html`<div class=${`lead-badge lead-badge--${shown.leadSuit}`}>
                  <span class="lead-caption">リード</span>
                  <${SuitGlyph} suit=${shown.leadSuit} />
                  <span class="lead-name">${SUIT_LABEL[shown.leadSuit]}</span>
                </div>`
              : html`<div class="lead-badge is-none">
                  <span class="lead-caption">リード</span>
                  <span class="lead-name">なし</span>
                </div>`}
            <span class="trick-tag">TRICK ${shown.index} / ${view.round}</span>
          </div>`}

      <div class="plays">
        ${plays.map(
          (play) => html`
            <div
              class=${`seat-play${shown.winnerSeat === play.seat ? " is-winner" : ""}`}
              key=${play.seat}
            >
              <span class="play-name">${nameOf(play.seat)}</span>
              <${CardView} card=${play.card} tigressAs=${play.tigressAs} size=${plays.length <= 3 ? "md" : "sm"} />
            </div>
          `,
        )}
      </div>

      ${shown.resolved
        ? shown.discarded
          ? html`<div class="arena-result is-discard">海底に沈みました</div>`
          : html`<div class="arena-result is-win">
              <span class="result-label">獲得</span>
              <b class="result-name">${winnerName}</b>
              ${bonus > 0 ? html`<span class="result-bonus">+${bonus}</span>` : null}
            </div>`
        : html`<div
            class=${`arena-result is-waiting${view.turnSeat === view.you.seat ? " is-mine" : ""}`}
          >
            ${view.turnSeat === view.you.seat ? "あなたの番" : `${nameOf(view.turnSeat)} が選んでいます`}
          </div>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// カード
// ---------------------------------------------------------------------------

const SUIT_MASK: Record<Suit, string> = {
  green: "/assets/cards/suit-parrot.webp",
  yellow: "/assets/cards/suit-chest.webp",
  purple: "/assets/cards/suit-map.webp",
  black: "/assets/cards/suit-jolly.webp",
};

function SuitGlyph(props: { suit: Suit }) {
  return html`<span
    class="suit-icon"
    style=${`--mask: url(${SUIT_MASK[props.suit]})`}
    aria-hidden="true"
  ></span>`;
}

function SkullGlyph() {
  return html`<svg class="skull-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.4c-4.6 0-8.1 3.2-8.1 7.2 0 2.6 1.4 4.9 3.6 6.2v3.3c0 .6.4 1 1 1h7c.6 0 1-.4 1-1v-3.3c2.2-1.3 3.6-3.6 3.6-6.2 0-4-3.5-7.2-8.1-7.2z"
    />
    <circle cx="9" cy="9.2" r="1.9" fill="#0b1a22" />
    <circle cx="15" cy="9.2" r="1.9" fill="#0b1a22" />
    <path d="M10.6 15.4h2.8v2.4h-2.8z" fill="#0b1a22" />
  </svg>`;
}

function CompassGlyph() {
  return html`<svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="1" opacity=".5" />
    <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35" />
    <path d="M24 7l3.2 13.6L41 24l-13.8 3.4L24 41l-3.2-13.6L7 24l13.8-3.4z" fill="currentColor" opacity=".45" />
    <circle cx="24" cy="24" r="2.4" fill="currentColor" opacity=".7" />
  </svg>`;
}

function CardView(props: {
  card: GameCard;
  tigressAs?: TigressUse;
  size?: "lg" | "md" | "sm" | "xs";
  state?: "play" | "off" | "idle";
  selected?: boolean;
  style?: string;
  onClick?: () => void;
}) {
  const face = faceOf(props.card, props.tigressAs);
  const art = artOf(props.card);
  const classes = [
    "card",
    `card--${props.size ?? "lg"}`,
    props.card.kind === "suit"
      ? `card--suit card--${props.card.suit}`
      : "card--special",
    art ? "has-art" : "",
    props.state === "play" ? "is-play" : props.state === "off" ? "is-off" : "",
    props.selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <button
      type="button"
      class=${classes}
      style=${props.style}
      disabled=${props.state === "off"}
      onClick=${props.onClick}
    >
      ${props.card.kind === "suit"
        ? html`
            <span class="card-corner">${props.card.rank}</span>
            <${SuitGlyph} suit=${props.card.suit} />
            <span class="card-corner card-corner--br">${props.card.rank}</span>
          `
        : art
          ? html`
              <span class="card-art"><img src=${art} alt="" draggable="false" /></span>
              <span class="card-name">${face.label}</span>
            `
          : html`
              <span class="card-mark">${face.mark}</span>
              <span class="card-name">${face.label}</span>
            `}
    </button>
  `;
}

// ---------------------------------------------------------------------------
// 結果表示
// ---------------------------------------------------------------------------

const BONUS_REASON_LABEL: Record<BonusReason, string> = {
  fourteen: "14",
  blackFourteen: "黒14",
  mermaidByPirate: "人魚捕獲",
  pirateBySkullKing: "海賊捕獲",
  skullKingByMermaid: "王捕獲",
  lootAlliance: "略奪品",
};

interface BonusTagItem {
  reason: BonusReason;
  label: string;
  points: number;
}

function summarizeBonuses(bonuses: TrickBonus[]): BonusTagItem[] {
  const grouped = new Map<BonusReason, { count: number; points: number }>();
  for (const item of bonuses) {
    const prev = grouped.get(item.reason) ?? { count: 0, points: 0 };
    grouped.set(item.reason, { count: prev.count + 1, points: prev.points + item.points });
  }
  const result: BonusTagItem[] = [];
  for (const [reason, { count, points }] of grouped) {
    const base = BONUS_REASON_LABEL[reason];
    const label = count > 1 ? `${base}×${count}` : base;
    result.push({ reason, label, points });
  }
  return result;
}

function RoundOverlay(props: {
  summary: RoundSummary;
  view: PlayerView;
  lobby: LobbyMessage | null;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}) {
  const final = props.view.round >= props.view.totalRounds;
  const nameOf = (seat: number): string =>
    props.view.players.find((player) => player.seat === seat)?.name ?? `席 ${seat}`;

  const ranked = [...props.summary.players].sort((a, b) => b.total - a.total);

  // 次へ進めるのは接続中の人間全員が押したとき。ボットと切断中の席は待たない。
  const humans = (props.lobby?.seats ?? []).filter((seat) => !seat.bot && seat.connected);
  const readyCount = humans.filter((seat) => seat.ready).length;
  const waiting = humans.length > 1;
  const myReady = humans.find((seat) => seat.seat === props.view.you.seat)?.ready === true;
  const readySeats = new Set(
    (props.lobby?.seats ?? []).filter((seat) => seat.ready && !seat.bot).map((seat) => seat.seat),
  );

  return html`
    <div class="overlay">
      <div class="panel">
        <header class="panel-head">
          <h2>ラウンド ${props.summary.round}</h2>
          <span class="panel-sub">${final ? "最終ラウンド" : `残り ${props.view.totalRounds - props.summary.round} ラウンド`}</span>
        </header>

        <table class="result-table">
          <thead>
            <tr>
              <th>船員</th>
              <th>ビッド</th>
              <th>取得</th>
              <th>ボーナス</th>
              <th>今回</th>
              <th>累計</th>
            </tr>
          </thead>
          <tbody>
            ${ranked.map((row) => {
              const tags = summarizeBonuses(row.bonuses ?? []);
              return html`
                <tr class=${row.seat === props.view.you.seat ? "is-me" : ""} key=${row.seat}>
                  <td class="cell-name">
                    ${nameOf(row.seat)}
                    ${waiting && readySeats.has(row.seat) && html`<span class="ready-tag">準備OK</span>`}
                  </td>
                  <td>
                    <span class="bid-chip${row.bidMade ? " is-made" : ""}">${row.bid}</span>
                  </td>
                  <td>
                    <span class="trick-count">${row.tricks}</span>
                  </td>
                  <td class="cell-bonus">
                    <div class="bonus-sum">${row.bonus > 0 ? `+${row.bonus}` : "–"}</div>
                    ${tags.length > 0 &&
                    html`<div class="bonus-list">
                      ${tags.map(
                        (tag) => html`
                          <span
                            key=${tag.reason}
                            class=${`bonus-tag${row.bidMade ? "" : " is-lost"}`}
                            title=${row.bidMade ? `${tag.label} +${tag.points}` : `ビッド失敗により没収 (${tag.label} +${tag.points})`}
                          >
                            ${tag.label} +${tag.points}
                          </span>
                        `,
                      )}
                    </div>`}
                  </td>
                  <td class=${row.total >= 0 ? "positive" : "negative"}>
                    ${row.total > 0 ? `+${row.total}` : row.total}
                  </td>
                  <td class="cell-total">${row.scoreAfter}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>

        <div class="actions">
          ${waiting &&
          html`<span class="ready-count">
            準備完了 <b>${readyCount}</b> / ${humans.length} 人
          </span>`}
          ${myReady
            ? html`<button disabled>他の船員を待っています…</button>`
            : html`<button class="primary" onClick=${() => props.send({ t: "nextRound" })}>
                ${final ? "結果を見る" : "次のラウンド"}
              </button>`}
        </div>
      </div>
    </div>
  `;
}

function GameOverOverlay(props: {
  view: PlayerView;
  send: (message: ClientMessage) => void;
  isHost: boolean;
  onLeave: () => void;
}) {
  const ranked = [...props.view.players].sort((a, b) => b.score - a.score);

  return html`
    <div class="overlay">
      <div class="panel">
        <div class="panel-hero"><img src="/assets/hero.webp" alt="" draggable="false" /></div>
        <header class="panel-head">
          <h2>航海の終わり</h2>
          <span class="panel-sub">${props.view.totalRounds} ラウンド終了</span>
        </header>
        <ol class="ranking">
          ${ranked.map(
            (player, index) => html`
              <li class=${props.view.winnerSeats.includes(player.seat) ? "is-winner" : ""} key=${player.seat}>
                <span class="rank-no">${index + 1}</span>
                <span class="rank-name">${player.name}</span>
                <span class="rank-score">${player.score}<small>点</small></span>
              </li>
            `,
          )}
        </ol>
        <div class="actions">
          <button class="ghost" onClick=${props.onLeave}>下船する</button>
          ${props.isHost
            ? html`<button class="primary" onClick=${() => props.send({ t: "start" })}>
                もう一度航海する
              </button>`
            : html`<button disabled>船長の再出航待ち</button>`}
        </div>
      </div>
    </div>
  `;
}

function RulesOverlay(props: { onClose: () => void }) {
  return html`
    <div class="overlay" onClick=${props.onClose}>
      <div class="panel panel--rules" onClick=${(event: Event) => event.stopPropagation()}>
        <header class="panel-head">
          <h2>ルール</h2>
          <button class="ghost" onClick=${props.onClose}>閉じる</button>
        </header>

        <div class="rules">
          <section>
            <h3>流れ</h3>
            <p>
              2〜6 人で 10 ラウンド。ラウンド N では手札が N 枚。各ラウンドは「ビッド → トリック → 得点」で、
              合計点がいちばん高い人の勝ちです。
            </p>
          </section>

          <section>
            <h3>ビッド</h3>
            <p>
              そのラウンドで取るトリック数を宣言します。0 も選べます。全員の入力が揃うまで、他人のビッドは見えません。
            </p>
          </section>

          <section>
            <h3>出せる札</h3>
            <p>
              リードが色札なら、その色を持っている人は必ずその色を出します。持っていなければ何を出してもかまいません。
              海賊・人魚・スカルキング・逃走・ティグレスのような特殊札は、いつでも出せます。
            </p>
            <p>
              リードが特殊札なら全員自由。逃走がリードのときは、そのトリックで最初に出た色札の色がリードスートになります。
            </p>
          </section>

          <section>
            <h3>強さ</h3>
            <ul>
              <li>海賊は色札に勝つ（黒は切り札なので、色札の中では最強）</li>
              <li>人魚は色札とスカルキングに勝つ</li>
              <li>スカルキングは海賊に勝つ</li>
              <li>3 種が同じトリックに出たら人魚の勝ち</li>
              <li>逃走はすべてに負ける</li>
              <li>同じ強さ同士は先に出したほうが勝ち</li>
            </ul>
          </section>

          <section>
            <h3>得点</h3>
            <table class="rules-table">
              <tbody>
                <tr><th>ビッド 1 以上・的中</th><td>+20 × ビッド数 ＋ ボーナス</td></tr>
                <tr><th>ビッド 1 以上・失敗</th><td>−10 × ズレた枚数</td></tr>
                <tr><th>ビッド 0・0 枚で終了</th><td>+10 × ラウンド数</td></tr>
                <tr><th>ビッド 0・1 枚以上取った</th><td>−10 × ラウンド数</td></tr>
              </tbody>
            </table>
            <p class="rules-note">ビッドを外すと、ボーナスはすべて没収されます。</p>
            <table class="rules-table">
              <tbody>
                <tr><th>14（緑・黄・紫）</th><td>1 枚 +10</td></tr>
                <tr><th>黒の 14</th><td>1 枚 +20</td></tr>
                <tr><th>海賊が人魚を取った</th><td>人魚 1 枚 +20</td></tr>
                <tr><th>スカルキングが海賊を取った</th><td>海賊 1 枚 +30</td></tr>
                <tr><th>人魚がスカルキングを取った</th><td>+40</td></tr>
              </tbody>
            </table>
            <p class="rules-note">ボーナスは、自分が取ったトリックの中身に対して付きます。</p>
          </section>

          <section>
            <h3>拡張カード</h3>
            <ul>
              <li>クラーケン — 出たらそのトリックは流れ、誰も取りません</li>
              <li>白クジラ — 特殊札が勝てなくなり、場の色札の数字で決まります</li>
              <li>略奪品 — 取った人と出した人が両方ビッドを当てていれば +20</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  `;
}

function Scoreboard(props: { view: PlayerView; onClose: () => void }) {
  const players = props.view.players;
  const history = props.view.roundHistory;

  return html`
    <div class="overlay" onClick=${props.onClose}>
      <div class="panel panel--wide" onClick=${(event: Event) => event.stopPropagation()}>
        <header class="panel-head">
          <h2>スコアボード</h2>
          <button class="ghost" onClick=${props.onClose}>閉じる</button>
        </header>
        <table class="scoreboard">
          <thead>
            <tr>
              <th>R</th>
              ${players.map((player) => html`<th key=${player.seat}>${player.name}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${history.map(
              (summary) => html`
                <tr key=${summary.round} class=${summary.round === props.view.round ? "is-current" : ""}>
                  <th>${summary.round}</th>
                  ${players.map((player) => {
                    const row = summary.players.find((entry) => entry.seat === player.seat);
                    const value = row?.total ?? 0;
                    return html`<td
                      key=${player.seat}
                      class=${value >= 0 ? "positive" : "negative"}
                    >
                      ${value > 0 ? `+${value}` : value}
                    </td>`;
                  })}
                </tr>
              `,
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>計</th>
              ${players.map((player) => html`<td key=${player.seat}>${player.score}</td>`)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}





