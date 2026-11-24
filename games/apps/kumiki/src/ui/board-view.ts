/**
 * The playing surface shared by the assembly screen and the exam: structures to fill
 * and the tray of tiles, with dragging and tap-to-place. It draws what its host tells
 * it and reports what the player does; it keeps no game state of its own beyond which
 * tile is selected.
 */

import type { AssemblyMemory, AssemblyPuzzle, ComponentTile, TriedMark } from "@kankyouken/mechanics/components";
import { slotOf, type Board } from "../board";
import { h } from "./dom";
import { enableDrag, type SlotRef } from "./drag";
import { frameDrawing, tileShape } from "./shapes";

export interface BoardHost {
  readonly puzzle: AssemblyPuzzle;
  /** Structures on show, as indices into `puzzle.layouts`. */
  readonly layouts: readonly number[];
  board(): Board;
  /** What has been tried so far, for tinting; null shows no tints. */
  memory(): AssemblyMemory | null;
  /** While true nothing can be moved. */
  locked(): boolean;
  place(layout: number, slot: number, tileId: string): void;
  remove(tileId: string): void;
  /** A tile was picked up or set down. */
  touched(tile: ComponentTile): void;
}

export interface BoardView {
  readonly frames: HTMLElement;
  readonly tray: HTMLElement;
  /** Redraw from the host's state. */
  refresh(): void;
  dispose(): void;
}

const MARK_ICON: Readonly<Record<TriedMark, string>> = { untried: "", wrong: "✕", right: "✓" };

function badge(mark: TriedMark): HTMLElement | null {
  return mark === "untried" ? null : h("span", { class: "mark-badge", "aria-hidden": "true" }, MARK_ICON[mark]);
}

/**
 * Build the surface inside `root`, which must contain both returned elements once the
 * caller has placed them: pointer events are listened for there.
 */
export function createBoardView(root: HTMLElement, host: BoardHost): BoardView {
  const { puzzle } = host;
  const tiles = new Map(puzzle.tray.map((tile) => [tile.id, tile]));
  const frames = h("div", { class: "frames", "data-count": host.layouts.length });
  const tray = h("div", { class: "tray", role: "group", "aria-label": "Tiles" });
  tray.style.setProperty("--tray-columns", String(Math.ceil(puzzle.tray.length / puzzle.trayRows)));
  let selected: string | null = null;

  const refresh = (): void => {
    const board = host.board();
    const memory = host.memory();
    if (selected !== null && (host.locked() || slotOf(board, selected) >= 0)) selected = null;

    frames.replaceChildren(
      ...host.layouts.map((index, position) => {
        const layout = puzzle.layouts[index]!;
        const inPlay = board.layout === index;
        const mark = memory?.layouts[index] ?? "untried";
        const showMisses = memory !== null && memory.structureFound && index === puzzle.correctLayout;
        return h(
          "div",
          {
            class: "structure",
            "data-layout": index,
            "data-mark": mark,
            "data-active": inPlay ? "true" : "false",
            role: "group",
            "aria-label": `Structure ${position + 1}${mark === "untried" ? "" : `, ${mark}`}`,
          },
          frameDrawing(layout, index, {
            placed: layout.slots.map((_, slot) => (inPlay ? (tiles.get(board.slots[slot] ?? "") ?? null) : null)),
            misses: layout.slots.map((_, slot) =>
              showMisses ? (memory.slotMisses[slot] ?? []).flatMap((id) => tiles.get(id) ?? []) : [],
            ),
          }),
          badge(mark),
        );
      }),
    );

    tray.replaceChildren(
      ...puzzle.tray.map((tile, position) => {
        const mark = memory?.tiles[tile.id] ?? "untried";
        const placed = slotOf(board, tile.id) >= 0;
        return h(
          "button",
          {
            type: "button",
            class: "tile",
            "data-tile": tile.id,
            "data-mark": mark,
            "data-placed": placed ? "true" : "false",
            "data-selected": selected === tile.id ? "true" : "false",
            "aria-pressed": selected === tile.id ? "true" : "false",
            "aria-label": `Tile ${position + 1}${placed ? ", placed" : ""}${mark === "untried" ? "" : `, ${mark === "right" ? "belongs" : "does not belong"}`}`,
            disabled: host.locked(),
          },
          tileShape(tile.glyph),
          badge(mark),
        );
      }),
    );
    frames.toggleAttribute("data-armed", selected !== null);
  };

  const place = (target: SlotRef, tileId: string): void => {
    const tile = tiles.get(tileId);
    if (tile === undefined || host.locked() || !host.layouts.includes(target.layout)) return;
    selected = null;
    host.place(target.layout, target.slot, tileId);
    host.touched(tile);
    refresh();
  };

  const activateTile = (tileId: string): void => {
    const tile = tiles.get(tileId);
    if (tile === undefined || host.locked()) return;
    if (slotOf(host.board(), tileId) >= 0) {
      host.remove(tileId);
    } else if (selected === tileId) {
      selected = null;
    } else {
      selected = tileId;
      host.touched(tile);
    }
    refresh();
  };

  const activateSlot = (target: SlotRef): void => {
    if (host.locked()) return;
    if (selected !== null) {
      place(target, selected);
      return;
    }
    const board = host.board();
    const occupant = board.layout === target.layout ? (board.slots[target.slot] ?? null) : null;
    if (occupant !== null) {
      host.remove(occupant);
      refresh();
    }
  };

  const slotRef = (element: Element | null): SlotRef | null =>
    element === null
      ? null
      : { layout: Number(element.getAttribute("data-layout")), slot: Number(element.getAttribute("data-slot")) };

  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const tile = event.target.closest(".tile");
    if (tile !== null) {
      const id = tile.getAttribute("data-tile") ?? "";
      const focused = document.activeElement === tile;
      activateTile(id);
      // The redraw replaced the button; keep the keyboard where it was.
      if (focused) tray.querySelector<HTMLElement>(`.tile[data-tile="${id}"]`)?.focus();
      return;
    }
    const slot = slotRef(event.target.closest(".slot"));
    if (slot !== null) activateSlot(slot);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof Element) || !event.target.matches(".slot")) return;
    event.preventDefault();
    const slot = slotRef(event.target);
    if (slot === null) return;
    activateSlot(slot);
    frames.querySelector<SVGElement>(`.slot[data-layout="${slot.layout}"][data-slot="${slot.slot}"]`)?.focus();
  };
  tray.addEventListener("click", onClick);
  frames.addEventListener("click", onClick);
  frames.addEventListener("keydown", onKey);

  const setHover = (target: SlotRef | null): void => {
    for (const slot of frames.querySelectorAll('.slot[data-hover="true"]')) slot.removeAttribute("data-hover");
    if (target === null) return;
    frames
      .querySelector(`.slot[data-layout="${target.layout}"][data-slot="${target.slot}"]`)
      ?.setAttribute("data-hover", "true");
  };

  const stopDrag = enableDrag(root, {
    pick(target) {
      if (host.locked()) return null;
      const origin = target.closest('.tile[data-placed="false"], .slot[data-filled="true"]');
      const tileId = origin?.getAttribute("data-tile");
      return origin !== null && tileId ? { tileId, origin } : null;
    },
    ghost(tileId) {
      const tile = tiles.get(tileId)!;
      return h("div", { class: "tile drag-ghost", "data-mark": host.memory()?.tiles[tileId] ?? "untried" }, tileShape(tile.glyph));
    },
    lifted(tileId) {
      const tile = tiles.get(tileId);
      if (tile !== undefined) host.touched(tile);
    },
    hover: setHover,
    dropped(tileId, target) {
      if (target !== null) place(target, tileId);
      else if (slotOf(host.board(), tileId) >= 0) {
        host.remove(tileId);
        refresh();
      }
    },
  });

  refresh();
  return {
    frames,
    tray,
    refresh,
    dispose() {
      stopDrag();
      tray.removeEventListener("click", onClick);
      frames.removeEventListener("click", onClick);
      frames.removeEventListener("keydown", onKey);
    },
  };
}
