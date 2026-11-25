import type { Card, PirateId, SpecialKind, Suit, SuitCard } from "../src/index.js";

export function suit(suitName: Suit, rank: number): SuitCard {
  return { id: `${suitName}-${rank}`, kind: "suit", suit: suitName, rank };
}

export function special(kind: SpecialKind, id?: string, pirate?: PirateId): Card {
  const card: Card = { id: id ?? kind, kind };
  if (pirate) card.pirate = pirate;
  return card;
}

/** 決定的な簡易乱数（テスト用）。 */
export function seeded(stateseed: number): () => number {
  let x = stateseed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}
