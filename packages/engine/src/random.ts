/**
 * 決定的な乱数。状態に数値 1 個だけ持たせるので、シードから同じ対戦を再現できる。
 */

export interface RngState {
  rng: number;
}

/** 線形合同法 (Numerical Recipes 版)。ゲーム用途なので暗号強度は不要。 */
export function nextRandom(state: RngState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 0x100000000;
}

export function nextInt(state: RngState, bound: number): number {
  return Math.floor(nextRandom(state) * bound);
}

/** Fisher-Yates。渡した配列をその場で並べ替えて返す。 */
export function shuffleInPlace<T>(items: T[], state: RngState): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}
