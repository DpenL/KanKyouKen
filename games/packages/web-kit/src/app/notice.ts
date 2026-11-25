/**
 * Telling the player when a study session is not being recorded.
 *
 * A game that reports to the platform can fail to do so without anything looking wrong:
 * the launch link lost its token, the collector refuses the token, or the network is
 * down. The player then plays a session that leaves no data, or data that arrives later.
 * This notice says so on screen. It is our own addition; the research games logged
 * locally and had nothing of the kind.
 */

import type { CollectorStatus } from "../telemetry/sink";
import { studyLinkState, type LaunchParams } from "./params";

/** Marks the notice element, for styles and tests. */
export const RECORDING_NOTICE_ATTRIBUTE = "data-kk-recording-notice";

/**
 * The custom property, set on the document's root element, that holds the height the
 * notice takes at the top of the page (`0px` while it is hidden). A game that sizes
 * itself to the height of the screen subtracts it, so that nothing it shows is pushed
 * below the screen.
 */
export const RECORDING_NOTICE_HEIGHT_PROPERTY = "--kk-recording-notice-height";

/**
 * A strip across the top of the page that takes its own room there, above the game:
 * laid over the page, it hid the controls along the top of a game screen (its texts wrap
 * to two lines on a phone) for the whole of a session that is not being recorded.
 */
const NOTICE_STYLE: Readonly<Record<string, string>> = {
  display: "block",
  boxSizing: "border-box",
  margin: "0",
  padding: "max(2px, env(safe-area-inset-top)) 8px 2px",
  font: "600 12px/1.3 system-ui, sans-serif",
  textAlign: "center",
  color: "#4a3200",
  background: "rgba(255, 236, 179, 0.96)",
  borderBottom: "1px solid #d9a441",
};

export interface RecordingNotice {
  readonly element: HTMLElement;
  /** Show the text, or hide the notice with null. */
  show(message: string | null): void;
}

/**
 * The notice element: `role="status"`, styled inline (no stylesheet needed), hidden
 * until `show` is given a text. Put `element` anywhere in the document.
 */
export function createRecordingNotice(doc: Pick<Document, "createElement"> = document): RecordingNotice {
  const element = doc.createElement("div");
  element.setAttribute("role", "status");
  element.setAttribute(RECORDING_NOTICE_ATTRIBUTE, "");
  Object.assign(element.style, NOTICE_STYLE);
  element.hidden = true;
  return {
    element,
    show(message) {
      element.hidden = message === null;
      // Unchanged text is not set again: a live region would be read out once more.
      if (element.textContent !== (message ?? "")) element.textContent = message ?? "";
    },
  };
}

/**
 * What to tell the player about recording, or null when there is nothing to tell: plain
 * play without a study link, or a study link whose events are getting through.
 * `status` is the collector sink's, for a complete link. While events cannot be sent, it
 * says that they are kept on the device only when storage holds all of them.
 */
export function recordingMessage(params: LaunchParams, status?: CollectorStatus): string | null {
  const link = studyLinkState(params);
  if (link === "none") return null;
  if (link === "incomplete") {
    const lacks = params.missing === undefined || params.missing.length === 0 ? "" : ` (no ${params.missing.join(", no ")})`;
    return `Not being recorded: the study link is incomplete${lacks}. Please open the full link again.`;
  }
  if (status === undefined) return null;
  const lost = status.dropped === 0 ? "" : ` ${status.dropped} ${status.dropped === 1 ? "event" : "events"} could not be kept.`;
  if (status.state === "rejected") {
    return `Not being recorded: the study link was not accepted. Please tell the researcher.${lost}`;
  }
  if (status.state === "retrying") {
    if (status.stored >= status.pending) return `Results cannot be sent right now. They are kept on this device and sent later.${lost}`;
    // Storage is full or refuses: what it does not hold is lost if the page closes.
    const them = status.stored === 0 ? "them" : "them all";
    return `Results cannot be sent right now, and this device cannot keep ${them}. Please keep this page open until they are sent.${lost}`;
  }
  return lost === "" ? null : `Recording, but${lost.toLowerCase()}`;
}

/**
 * Put a recording notice at the top of `host` (the page's body by default), before
 * everything else in it, and keep it up to date. An incomplete study link is announced
 * at once and for good. For a complete link, pass the returned function to the
 * collector sink as `onStatus`. The height the notice takes is kept in
 * `RECORDING_NOTICE_HEIGHT_PROPERTY` on the document's root element, also as the text
 * wraps differently when the window changes size. Without a study link nothing is added
 * to the page, the page is not even looked at (so this is safe to call where there is
 * none), and the function does nothing.
 */
export function mountRecordingNotice(
  params: LaunchParams,
  host?: Pick<Node, "insertBefore" | "firstChild">,
  doc?: Pick<Document, "createElement">,
): (status: CollectorStatus) => void {
  if (studyLinkState(params) === "none") return () => undefined;
  const notice = createRecordingNotice(doc ?? document);
  const { element } = notice;
  const into = host ?? document.body;
  into.insertBefore(element, into.firstChild);
  const root = element.ownerDocument?.documentElement;
  const publishHeight = (): void => {
    root?.style.setProperty(RECORDING_NOTICE_HEIGHT_PROPERTY, `${element.hidden ? 0 : element.offsetHeight}px`);
  };
  if (root !== undefined && typeof ResizeObserver === "function") new ResizeObserver(publishHeight).observe(element);
  const show = (message: string | null): void => {
    notice.show(message);
    publishHeight();
  };
  show(recordingMessage(params));
  return (status) => show(recordingMessage(params, status));
}
