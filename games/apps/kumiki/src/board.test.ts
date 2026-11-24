import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, boardOn, isFull, placeTile, removeTile, slotOf } from "./board";

describe("board", () => {
  it("starts with no structure in play", () => {
    expect(EMPTY_BOARD).toEqual({ layout: null, slots: [] });
    expect(isFull(EMPTY_BOARD)).toBe(false);
  });

  it("places tiles into the structure in play", () => {
    let board = placeTile(EMPTY_BOARD, 2, 3, 1, "a");
    expect(board).toEqual({ layout: 2, slots: [null, "a", null] });
    board = placeTile(board, 2, 3, 0, "b");
    expect(board.slots).toEqual(["b", "a", null]);
    expect(isFull(board)).toBe(false);
    board = placeTile(board, 2, 3, 2, "c");
    expect(isFull(board)).toBe(true);
    expect(slotOf(board, "c")).toBe(2);
    expect(slotOf(board, "z")).toBe(-1);
  });

  it("moves the player to another structure and returns the old placements to the tray", () => {
    const old = placeTile(placeTile(EMPTY_BOARD, 0, 2, 0, "a"), 0, 2, 1, "b");
    const moved = placeTile(old, 1, 3, 2, "b");
    expect(moved).toEqual({ layout: 1, slots: [null, null, "b"] });
    expect(slotOf(moved, "a")).toBe(-1);
  });

  it("swaps two slots when a placed tile is dropped on an occupied slot", () => {
    const board = placeTile(placeTile(boardOn(0, 3), 0, 3, 0, "a"), 0, 3, 1, "b");
    expect(placeTile(board, 0, 3, 1, "a").slots).toEqual(["b", "a", null]);
  });

  it("moves a placed tile to an empty slot, leaving its old slot empty", () => {
    const board = placeTile(boardOn(0, 3), 0, 3, 0, "a");
    expect(placeTile(board, 0, 3, 2, "a").slots).toEqual([null, null, "a"]);
  });

  it("replaces the occupant when a tile comes from the tray", () => {
    const board = placeTile(boardOn(0, 2), 0, 2, 0, "a");
    const next = placeTile(board, 0, 2, 0, "b");
    expect(next.slots).toEqual(["b", null]);
    expect(slotOf(next, "a")).toBe(-1);
  });

  it("ignores slots the structure does not have and drops on the tile's own slot", () => {
    const board = placeTile(boardOn(0, 2), 0, 2, 0, "a");
    expect(placeTile(board, 0, 2, 2, "b")).toBe(board);
    expect(placeTile(board, 0, 2, -1, "b")).toBe(board);
    expect(placeTile(board, 0, 2, 0, "a")).toBe(board);
  });

  it("returns a tile to the tray and keeps the structure in play", () => {
    const board = placeTile(boardOn(1, 2), 1, 2, 1, "a");
    expect(removeTile(board, "a")).toEqual({ layout: 1, slots: [null, null] });
    expect(removeTile(board, "zz")).toBe(board);
  });
});
