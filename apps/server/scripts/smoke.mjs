/**
 * サーバーの通し確認スクリプト。2 人が入室し、ボット 1 体を加えて
 * ビッドとトリックを自動で進め、最終結果まで到達することを確かめる。
 *
 *   node apps/server/scripts/smoke.mjs
 */
import WebSocket from "ws";

const URL = process.env.WS_URL ?? "ws://localhost:8123/ws";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.view = null;
    this.session = null;
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL);
      this.ws = ws;
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw));
        if (message.t === "welcome") this.session = message;
        if (message.t === "state") this.view = message.view;
        if (message.t === "error") {
          console.error(`[${this.name}] error:`, message.code, message.message);
          this.error = message;
        }
        for (const waiter of [...this.waiters]) {
          if (waiter.match(message)) {
            this.waiters = this.waiters.filter((w) => w !== waiter);
            waiter.resolve(message);
          }
        }
      });
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(match, label = "message", timeout = 8000) {
    const found = this.waiters.find((w) => w.match === match);
    if (found) return found.promise;
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: null };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timeout waiting for ${label} (${this.name})`));
      }, timeout);
      waiter.resolve = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(waiter);
    });
  }

  async sendAndWait(message, match) {
    this.send(message);
    return this.waitFor(match ?? ((m) => m.t === "state"), "state");
  }

  close() {
    this.ws?.close();
  }
}

function randomBid(round) {
  return Math.floor(Math.random() * (round + 1));
}

const alice = new Client("alice");
const bob = new Client("bob");
let checks = 0;

function check(condition, label) {
  checks += 1;
  if (!condition) throw new Error(`check failed: ${label}`);
}

await alice.connect();
alice.send({ t: "hello", name: "アリス" });
const welcome = await alice.waitFor((m) => m.t === "welcome", "alice welcome");
const code = welcome.code;

await bob.connect();
bob.send({ t: "hello", name: "ボブ", code });
await bob.waitFor((m) => m.t === "welcome", "bob welcome");

alice.send({ t: "addBot" });
await alice.waitFor(
  (m) => m.t === "lobby" && m.seats.length === 3,
  "lobby with 3 seats",
);

alice.send({ t: "start" });
const firstState = await alice.waitFor(
  (m) => m.t === "state" && m.view.players.length === 3,
  "first state",
);
check(firstState.view.phase === "bidding", "starts in bidding");
check(firstState.view.you.hand.length === 1, "round 1 deals 1 card");

// 切断 → 復帰
bob.close();
await sleep(300);
const resumeToken = bob.session;
await bob.connect();
bob.send({
  t: "resume",
  code: resumeToken.code,
  playerId: resumeToken.playerId,
  token: resumeToken.token,
});
await bob.waitFor((m) => m.t === "welcome", "bob resume welcome");
const resumed = await bob.waitFor((m) => m.t === "state", "state after resume");
check(resumed.view.round === 1, "resume keeps the game");
checks += 1;
console.log("resume: ok");

let lastRound = 0;
let sawHiddenBid = false;
let sawTigress = false;

for (let guard = 0; guard < 4000; guard += 1) {
  const view = alice.view;
  if (!view) {
    await sleep(20);
    continue;
  }

  // ビッドは全員分が揃うまで他人には伏せられている
  if (view.phase === "bidding") {
    for (const player of view.players) {
      if (player.seat !== view.you.seat && player.bid !== null) {
        throw new Error("other player's bid leaked during bidding");
      }
    }
    sawHiddenBid = true;
  }

  if (view.phase === "roundEnd") {
    if (view.round > lastRound) {
      lastRound = view.round;
      console.log(
        `round ${view.round}: ` +
          view.lastRound.players.map((p) => `${p.bid}/${p.tricks}`).join(" "),
      );
    }
    // 接続中の人間は 2 人。1 人だけでは次へ進まないことを確かめてから、2 人目を押す。
    const roundBefore = view.round;
    alice.send({ t: "nextRound" });
    await sleep(250);
    check(alice.view.phase === "roundEnd", "a single ready player does not advance");
    check(alice.view.round === roundBefore, "round stays until everyone is ready");
    bob.send({ t: "nextRound" });
    await alice.waitFor(
      (m) => m.t === "state" && (m.view.round > roundBefore || m.view.phase === "gameEnd"),
      "round advanced after both ready",
    );
    continue;
  }

  if (view.phase === "gameEnd") break;

  const actors = [alice, bob];
  let acted = false;
  for (const client of actors) {
    const actorView = client.view;
    if (!actorView || !actorView.you.canAct) continue;
    if (actorView.phase === "bidding") {
      await client.sendAndWait({ t: "bid", bid: randomBid(actorView.round) });
      acted = true;
      break;
    }
    if (actorView.phase === "playing") {
      const option = actorView.you.legalPlays[Math.floor(Math.random() * actorView.you.legalPlays.length)];
      if (!option) throw new Error("no legal play offered");
      if (option.tigressAs) sawTigress = true;
      await client.sendAndWait({
        t: "play",
        cardId: option.cardId,
        ...(option.tigressAs ? { tigressAs: option.tigressAs } : {}),
      });
      acted = true;
      break;
    }
  }
  if (!acted) await sleep(40);
}

const finalView = alice.view;
check(finalView.phase === "gameEnd", "game reached gameEnd");
check(finalView.winnerSeats.length >= 1, "winner exists");
check(sawHiddenBid, "bids were hidden");
check(lastRound === 10, "played 10 rounds");

console.log("final:", finalView.players.map((p) => `${p.name}=${p.score}`).join(" "));

// ---- 拡張カード入りの部屋 ----
const carol = new Client("carol");
await carol.connect();
carol.send({ t: "hello", name: "キャロル" });
await carol.waitFor((m) => m.t === "welcome", "carol welcome");

carol.send({
  t: "setOptions",
  options: { includeKraken: true, includeWhiteWhale: true, includeLoot: true },
});
await carol.waitFor(
  (m) => m.t === "lobby" && m.options?.includeKraken && m.options?.includeLoot,
  "expansion options applied",
);

carol.send({ t: "addBot" });
await carol.waitFor((m) => m.t === "lobby" && m.seats.length === 2, "carol bot added");

carol.send({ t: "start" });
const expansionState = await carol.waitFor(
  (m) => m.t === "state" && m.view.players.length === 2,
  "expansion state",
);
check(expansionState.view.options.includeKraken, "kraken flag reaches the engine");
check(expansionState.view.options.includeWhiteWhale, "white whale flag reaches the engine");
check(expansionState.view.options.includeLoot, "loot flag reaches the engine");
check(
  expansionState.view.deckRemaining === 74 - 2,
  `expansion deck has 74 cards (deckRemaining=${expansionState.view.deckRemaining})`,
);
console.log("expansion room: ok");

console.log(`smoke ok (${checks} checks, tigress used: ${sawTigress})`);
alice.close();
bob.close();
carol.close();
process.exit(0);
