/** Modal dialogs: credits, settings, and choosing a deck for the exam. */

import { STARTER_JA_GLYPHS } from "@kankyouken/glyph-data";
import type { Deck } from "../content";
import type { App } from "./app";
import { armOverlay, noteClick, type Switchable } from "./arm";
import { button, h } from "./dom";

const CREDITS =
  "Mechanics based on published research by Oleksandra Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022). Independent implementation; not affiliated with the authors.";

/**
 * Show a modal dialog; it removes itself when closed. What a tap brings under the
 * finger by opening or closing it is held (see `armOverlay`): on a phone the rest of
 * a double tap on Exam would otherwise pick a deck in the chooser, or close the dialog
 * again from its backdrop, and the rest of one on Close would open the deck card behind it.
 */
function open(app: App, name: string, title: string, ...body: (Node | string)[]): HTMLDialogElement {
  const heading = h("h2", { id: `dialog-${name}` }, title);
  const dialog = h("dialog", { class: "dialog", "data-dialog": name, "aria-labelledby": heading.id });
  dialog.append(heading, ...body, h("div", { class: "dialog-actions" }, button("Close", { class: "primary", "data-action": "close" }, () => dialog.close())));
  dialog.addEventListener("close", () => {
    dialog.remove();
    armOverlay(app.arming, document.body);
  });
  // The backdrop is no button, so it is held through a stand-in, and presses on it are passed on by hand.
  const backdrop: Switchable = { disabled: false };
  dialog.addEventListener("pointerdown", (event) => {
    if (event.target === dialog) app.arming.pressed(backdrop);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog || backdrop.disabled) return;
    // Counted before closing, so that the close listener holds what the rest of the tap would land on.
    noteClick(app.arming, event);
    dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  app.arming.hold([backdrop]);
  armOverlay(app.arming, dialog);
  return dialog;
}

export function openAbout(app: App): void {
  open(
    app,
    "about",
    "About Kumiki",
    h("p", {}, "Kumiki (組木) is wooden joinery: parts cut to fit each other without nails. Here the parts are the components of kanji."),
    h("p", { "data-credit": "data" }, `Character shapes: ${STARTER_JA_GLYPHS.source.attribution}, licensed CC BY-SA 3.0.`),
    h("p", { "data-credit": "research" }, CREDITS),
  );
}

export function openSettings(app: App): void {
  const saved = app.store.get();
  const sound = h("input", { type: "checkbox", id: "setting-sound", checked: saved.sound });
  const volume = h("input", {
    type: "range",
    id: "setting-volume",
    min: 0,
    max: 100,
    step: 5,
    value: Math.round(saved.volume * 100),
    disabled: !saved.sound,
  });
  const apply = (): void => {
    const next = app.store.patch({ sound: sound.checked, volume: Number(volume.value) / 100 });
    volume.disabled = !next.sound;
    app.sound.apply(next);
  };
  sound.addEventListener("change", apply);
  volume.addEventListener("input", apply);
  // Let the player hear the level they picked.
  volume.addEventListener("change", () => app.sound.cue("tick"));
  open(
    app,
    "settings",
    "Settings",
    h("div", { class: "setting" }, h("label", { for: sound.id }, "Sound"), sound),
    h("div", { class: "setting" }, h("label", { for: volume.id }, "Volume"), volume),
  );
}

export function openExamChooser(app: App, start: (deck: Deck) => void): void {
  // The choices are in place before the dialog opens, so that the one under the finger can be held.
  const choices = app.content.decks.map((deck) => {
    const choice = button(deck.title, { class: "ghost", "data-deck": deck.id }, () => {
      dialog.close();
      start(deck);
    });
    if (deck.shared !== null) choice.append(" ", h("span", { lang: "ja" }, deck.shared));
    return choice;
  });
  const dialog = open(
    app,
    "exam",
    "Exam",
    h("p", {}, "Build every character of a deck from memory. Only the right structure is shown and nothing is marked until the end."),
    h("div", { class: "chooser" }, ...choices),
  );
}
