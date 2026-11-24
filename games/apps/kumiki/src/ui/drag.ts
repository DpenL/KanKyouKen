/**
 * Dragging tiles with any pointer. A press on something that can be picked up starts
 * tracking; once the pointer has moved a little, a floating copy follows it and the
 * slot under it is reported. A press released without moving is left to the ordinary
 * `click`, so taps and the keyboard share one code path.
 */

export interface SlotRef {
  readonly layout: number;
  readonly slot: number;
}

export interface DragHost {
  /** The tile a press on `target` picks up, with the element that represents it, or null. */
  pick(target: Element): { readonly tileId: string; readonly origin: Element } | null;
  /** The copy that follows the pointer. */
  ghost(tileId: string): HTMLElement;
  lifted(tileId: string): void;
  hover(slot: SlotRef | null): void;
  /** The tile was let go over a slot, or over nothing. */
  dropped(tileId: string, slot: SlotRef | null): void;
}

/** Movement, in CSS pixels, after which a press counts as a drag. */
const DRAG_THRESHOLD = 6;
/** How long after a drag the click the browser may still send to the dragged element is ignored. */
const CLICK_GUARD_MS = 120;

interface Active {
  readonly pointerId: number;
  readonly tileId: string;
  readonly origin: Element;
  readonly startX: number;
  readonly startY: number;
  ghost: HTMLElement | null;
  over: SlotRef | null;
}

/** The slot drawn at a point of the viewport, if any. */
function slotAt(x: number, y: number): SlotRef | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const slot = element.closest("[data-slot][data-layout]");
    if (slot === null) continue;
    return { layout: Number(slot.getAttribute("data-layout")), slot: Number(slot.getAttribute("data-slot")) };
  }
  return null;
}

function sameSlot(a: SlotRef | null, b: SlotRef | null): boolean {
  return a === b || (a !== null && b !== null && a.layout === b.layout && a.slot === b.slot);
}

/** Start listening on `root`. Returns a function that stops everything. */
export function enableDrag(root: HTMLElement, host: DragHost): () => void {
  let active: Active | null = null;
  let guard: { readonly origin: Element; readonly until: number } | null = null;

  const finish = (drop: boolean, x: number, y: number): void => {
    const current = active;
    if (current === null) return;
    active = null;
    if (current.origin.hasPointerCapture?.(current.pointerId)) current.origin.releasePointerCapture(current.pointerId);
    if (current.ghost === null) return;
    current.ghost.remove();
    current.origin.removeAttribute("data-dragging");
    host.hover(null);
    guard = { origin: current.origin, until: performance.now() + CLICK_GUARD_MS };
    if (drop) host.dropped(current.tileId, slotAt(x, y));
  };

  const onDown = (event: PointerEvent): void => {
    if (active !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (!(event.target instanceof Element)) return;
    const picked = host.pick(event.target);
    if (picked === null) return;
    active = {
      pointerId: event.pointerId,
      tileId: picked.tileId,
      origin: picked.origin,
      startX: event.clientX,
      startY: event.clientY,
      ghost: null,
      over: null,
    };
    picked.origin.setPointerCapture(event.pointerId);
  };

  const onMove = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    if (active.ghost === null) {
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < DRAG_THRESHOLD) return;
      active.ghost = host.ghost(active.tileId);
      document.body.append(active.ghost);
      active.origin.setAttribute("data-dragging", "true");
      host.lifted(active.tileId);
    }
    active.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    const over = slotAt(event.clientX, event.clientY);
    if (!sameSlot(over, active.over)) {
      active.over = over;
      host.hover(over);
    }
    event.preventDefault();
  };

  const onUp = (event: PointerEvent): void => {
    if (active !== null && event.pointerId === active.pointerId) finish(true, event.clientX, event.clientY);
  };
  const onCancel = (event: PointerEvent): void => {
    if (active !== null && event.pointerId === active.pointerId) finish(false, 0, 0);
  };
  const onClick = (event: MouseEvent): void => {
    const guarded = guard;
    guard = null;
    if (guarded === null || performance.now() >= guarded.until) return;
    if (event.target instanceof Node && guarded.origin.contains(event.target)) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onCancel);
  root.addEventListener("click", onClick, true);
  return () => {
    finish(false, 0, 0);
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onCancel);
    root.removeEventListener("click", onClick, true);
  };
}
