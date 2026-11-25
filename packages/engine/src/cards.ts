export type Suit = "green" | "yellow" | "purple" | "black";

export type PirateId = "rosie" | "bendt" | "rascal" | "juanita" | "harry";

/** ティグレスを出したときに選ぶ扱い。 */
export type TigressUse = "pirate" | "escape";

export type SpecialKind =
  | "pirate"
  | "tigress"
  | "skullKing"
  | "mermaid"
  | "escape"
  | "kraken"
  | "whiteWhale"
  | "loot";

export interface SuitCard {
  id: string;
  kind: "suit";
  suit: Suit;
  rank: number;
}

export interface SpecialCard {
  id: string;
  kind: SpecialKind;
  /** kind === "pirate" のときだけ入る */
  pirate?: PirateId;
}

export type Card = SuitCard | SpecialCard;

export interface DeckOptions {
  includeKraken: boolean;
  includeWhiteWhale: boolean;
  includeLoot: boolean;
}

export const SUITS: readonly Suit[] = ["green", "yellow", "purple", "black"] as const;

export const PIRATES: readonly PirateId[] = [
  "rosie",
  "bendt",
  "rascal",
  "juanita",
  "harry",
] as const;

/** 基本デッキの枚数。 */
export const BASE_DECK_SIZE = 4 * 14 + 5 + 1 + 1 + 2 + 5;

export function buildDeck(options: DeckOptions): Card[] {
  const cards: Card[] = [];

  for (const suit of SUITS) {
    for (let rank = 1; rank <= 14; rank++) {
      cards.push({ id: `${suit}-${rank}`, kind: "suit", suit, rank });
    }
  }

  for (const pirate of PIRATES) {
    cards.push({ id: `pirate-${pirate}`, kind: "pirate", pirate });
  }

  cards.push({ id: "skull-king", kind: "skullKing" });
  cards.push({ id: "mermaid-1", kind: "mermaid" });
  cards.push({ id: "mermaid-2", kind: "mermaid" });
  cards.push({ id: "tigress", kind: "tigress" });

  for (let i = 1; i <= 5; i++) {
    cards.push({ id: `escape-${i}`, kind: "escape" });
  }

  if (options.includeKraken) cards.push({ id: "kraken", kind: "kraken" });
  if (options.includeWhiteWhale) cards.push({ id: "white-whale", kind: "whiteWhale" });
  if (options.includeLoot) {
    cards.push({ id: "loot-1", kind: "loot" });
    cards.push({ id: "loot-2", kind: "loot" });
  }

  return cards;
}

export function isSuitCard(card: Card): card is SuitCard {
  return card.kind === "suit";
}

export type ResolvedKind =
  | "suit"
  | "pirate"
  | "skullKing"
  | "mermaid"
  | "escape"
  | "kraken"
  | "whiteWhale"
  | "loot";

/** ティグレスの選択を反映した「実際の扱い」。 */
export function resolvedKind(card: Card, tigressAs?: TigressUse): ResolvedKind {
  if (card.kind === "tigress") {
    return tigressAs === "escape" ? "escape" : "pirate";
  }
  return card.kind;
}

export const SUIT_LABEL: Record<Suit, string> = {
  green: "緑",
  yellow: "黄",
  purple: "紫",
  black: "黒",
};

export const KIND_LABEL: Record<ResolvedKind, string> = {
  suit: "色",
  pirate: "海賊",
  skullKing: "スカルキング",
  mermaid: "人魚",
  escape: "逃走",
  kraken: "クラーケン",
  whiteWhale: "白クジラ",
  loot: "略奪品",
};

export const PIRATE_LABEL: Record<PirateId, string> = {
  rosie: "ロージー・ディレイニー",
  bendt: "ベント・ザ・バンディット",
  rascal: "ラスカル・オブ・ロアタン",
  juanita: "ファニータ・ジェイド",
  harry: "ハリー・ザ・ジャイアント",
};

export function cardLabel(card: Card): string {
  if (card.kind === "suit") return `${SUIT_LABEL[card.suit]}${card.rank}`;
  if (card.kind === "pirate" && card.pirate) return PIRATE_LABEL[card.pirate];
  return KIND_LABEL[resolvedKind(card)];
}
