/**
 * Where the player's tiles sit before a check. Only one structure is in play at a time;
 * a tile sits in at most one slot.
 */

export interface Board {
  /** Index of the structure being filled, or null before the first placement. */
  readonly layout: number | null;
  /** Tile id per slot of that structure; null for an empty slot. */
  readonly slots: readonly (string | null)[];
}

export const EMPTY_BOARD: Board = { layout: null, slots: [] };

/** A board that starts on a given structure with every slot empty. */
export function boardOn(layout: number, slotCount: number): Board {
  return { layout, slots: new Array<string | null>(slotCount).fill(null) };
}

/** The slot a tile sits in, or -1 when it is in the tray. */
export function slotOf(board: Board, tileId: string): number {
  return board.slots.indexOf(tileId);
}

/**
 * Put a tile into a slot of a structure.
 *
 *  - Another structure than the one in play: the player moves there, and everything
 *    placed in the old structure returns to the tray.
 *  - The tile comes from another slot of the same structure: the two slots swap contents.
 *  - The tile comes from the tray: whatever sat in the slot returns to the tray.
 *
 * `slotCount` is the number of slots of `layout`. A slot index outside it changes nothing.
 */
export function placeTile(board: Board, layout: number, slotCount: number, slot: number, tileId: string): Board {
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) return board;
  if (board.layout !== layout) {
    const slots = new Array<string | null>(slotCount).fill(null);
    slots[slot] = tileId;
    return { layout, slots };
  }
  const slots = [...board.slots];
  const from = slots.indexOf(tileId);
  if (from === slot) return board;
  if (from >= 0) slots[from] = slots[slot] ?? null;
  slots[slot] = tileId;
  return { layout, slots };
}

/** Return a tile to the tray. The structure stays in play even when it is left empty. */
export function removeTile(board: Board, tileId: string): Board {
  if (!board.slots.includes(tileId)) return board;
  return { layout: board.layout, slots: board.slots.map((id) => (id === tileId ? null : id)) };
}

/** True when a structure is in play and every one of its slots holds a tile. */
export function isFull(board: Board): boolean {
  return board.layout !== null && board.slots.length > 0 && board.slots.every((id) => id !== null);
}
