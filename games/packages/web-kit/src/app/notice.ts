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
 * A strip along the top edge that is laid over the page: it takes no room in the layout
 * and lets every tap and click through, so the game under it plays as before. It does
 * cover what the game shows in its top two lines or so; the texts are kept short for
 * that reason.
 */
const NOTICE_STYLE: Readonly<Record<string, string>> = {
  position: "fixed",
  top: "0",
  left: "0",
  right: "0",
  zIndex: "2147483000",
  boxSizing: "border-box",
  margin: "0",
  padding: "max(2px, env(safe-area-inset-top)) 8px 2px",
  font: "600 12px/1.3 system-ui, sans-serif",
  textAlign: "center",
  color: "#4a3200",
  background: "rgba(255, 236, 179, 0.96)",
  borderBottom: "1px solid #d9a441",
  pointerEvents: "none",
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
 * `status` is the collector sink's, for a complete link.
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
    return `Results cannot be sent right now. They are kept on this device and sent later.${lost}`;
  }
  return lost === "" ? null : `Recording, but${lost.toLowerCase()}`;
}

/**
 * Put a recording notice into `host` (the page's body by default) and keep it up to
 * date. An incomplete study link is announced at once and for good. For a complete
 * link, pass the returned function to the collector sink as `onStatus`. Without a study
 * link nothing is added to the page, the page is not even looked at (so this is safe to
 * call where there is none), and the function does nothing.
 */
export function mountRecordingNotice(
  params: LaunchParams,
  host?: Pick<Node, "appendChild">,
  doc?: Pick<Document, "createElement">,
): (status: CollectorStatus) => void {
  if (studyLinkState(params) === "none") return () => undefined;
  const notice = createRecordingNotice(doc ?? document);
  (host ?? document.body).appendChild(notice.element);
  notice.show(recordingMessage(params));
  return (status) => notice.show(recordingMessage(params, status));
}
