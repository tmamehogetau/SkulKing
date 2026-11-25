import type { Card, Suit, TigressUse } from "@skulking/engine";

export const SUIT_ORDER: Record<Suit, number> = {
  green: 0,
  yellow: 1,
  purple: 2,
  black: 3,
};

export const SUIT_LABEL: Record<Suit, string> = {
  green: "緑",
  yellow: "黄",
  purple: "紫",
  black: "黒",
};

const SUIT_MARK: Record<Suit, string> = {
  green: "🦜",
  yellow: "💰",
  purple: "🗺️",
  black: "☠️",
};

export interface CardFace {
  mark: string;
  label: string;
  className: string;
}

const SPECIAL_FACES: Record<string, CardFace> = {
  pirate: { mark: "🏴‍☠️", label: "海賊", className: "card special pirate" },
  skullKing: { mark: "👑", label: "スカルキング", className: "card special skull-king" },
  mermaid: { mark: "🧜", label: "人魚", className: "card special mermaid" },
  tigress: { mark: "🐯", label: "ティグレス", className: "card special tigress" },
  escape: { mark: "💨", label: "逃走", className: "card special escape" },
  kraken: { mark: "🐙", label: "クラーケン", className: "card special kraken" },
  whiteWhale: { mark: "🐋", label: "白クジラ", className: "card special whale" },
  loot: { mark: "💎", label: "略奪品", className: "card special loot" },
};

export function faceOf(card: Card, tigressAs?: TigressUse): CardFace {
  if (card.kind === "suit") {
    return {
      mark: SUIT_MARK[card.suit],
      label: SUIT_LABEL[card.suit],
      className: `card suit-${card.suit}`,
    };
  }
  const face = SPECIAL_FACES[card.kind] ?? {
    mark: "?",
    label: "?",
    className: "card special",
  };
  if (card.kind === "tigress" && tigressAs) {
    return { ...face, label: tigressAs === "pirate" ? "ティグレス(海賊)" : "ティグレス(逃走)" };
  }
  return face;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const aSuit = a.kind === "suit" ? 0 : 1;
    const bSuit = b.kind === "suit" ? 0 : 1;
    if (aSuit !== bSuit) return aSuit - bSuit;
    if (a.kind === "suit" && b.kind === "suit") {
      if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
      return a.rank - b.rank;
    }
    return a.id.localeCompare(b.id);
  });
}

const PIRATE_ART: Record<string, string> = {
  rosie: "/assets/cards/pirate-rosie.webp",
  bendt: "/assets/cards/pirate-bendt.webp",
  rascal: "/assets/cards/pirate-rascal.webp",
  juanita: "/assets/cards/pirate-juanita.webp",
  harry: "/assets/cards/pirate-harry.webp",
};

const SPECIAL_ART: Record<string, string> = {
  skullKing: "/assets/cards/skull-king.webp",
  mermaid: "/assets/cards/mermaid.webp",
  tigress: "/assets/cards/tigress.webp",
  escape: "/assets/cards/escape.webp",
  kraken: "/assets/cards/kraken.webp",
  whiteWhale: "/assets/cards/whale.webp",
  loot: "/assets/cards/loot.webp",
};

/** 特殊カードのイラスト。色札は null（SVG のスートで描く）。 */
export function artOf(card: Card): string | null {
  if (card.kind === "suit") return null;
  if (card.kind === "pirate") {
    return (card.pirate && PIRATE_ART[card.pirate]) || PIRATE_ART.rosie || null;
  }
  return SPECIAL_ART[card.kind] ?? null;
}
