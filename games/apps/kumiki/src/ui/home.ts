/** The home screen: mode switch, decks, and the way to the exam, settings and credits. */

import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { Deck } from "../content";
import type { Mode } from "../round";
import { bestScore } from "../saved";
import type { App } from "./app";
import { button, h } from "./dom";
import { tileShape } from "./shapes";

export interface HomeActions {
  play(deck: Deck, mode: Mode): void;
  exam(): void;
  settings(): void;
  about(): void;
}

const MODES: readonly { readonly id: Mode; readonly title: string; readonly line: string }[] = [
  { id: "learn", title: "Learn", line: "You see the character first. Unlimited tries." },
  { id: "review", title: "Review", line: "Meaning and reading only. Five lives." },
];

/** A character drawn from the glyph data, so it looks the same whatever fonts the device has. */
export function drawnChar(glyph: Glyph | undefined, char: string, className: string): HTMLElement {
  const box = h("span", { class: className, lang: "ja", role: "img", "aria-label": char });
  if (glyph === undefined) box.textContent = char;
  else box.append(tileShape(glyph));
  return box;
}

/** The block on a deck's card: its shared component, or for the Mixed deck a mosaic of all of them. */
function emblem(app: App, deck: Deck): HTMLElement {
  const { glyphs, decks } = app.content;
  if (deck.shared !== null) return drawnChar(glyphs.get(deck.shared), deck.shared, "deck-emblem");
  const shared = decks.flatMap((other) => (other.shared === null ? [] : [other.shared])).slice(0, 4);
  return h("span", { class: "deck-emblem deck-emblem-mosaic", "aria-hidden": "true" }, ...shared.map((char) => drawnChar(glyphs.get(char), char, "deck-emblem-part")));
}

export function homeScreen(app: App, actions: HomeActions): HTMLElement {
  const decks = h("section", { class: "decks", "aria-label": "Decks" });
  const modes = h("div", { class: "modes", role: "radiogroup", "aria-label": "Mode" });

  const render = (): void => {
    const saved = app.store.get();
    modes.replaceChildren(
      ...MODES.map((mode) => {
        const option = h(
          "button",
          { type: "button", class: "mode", role: "radio", "data-mode": mode.id, "aria-checked": saved.mode === mode.id ? "true" : "false" },
          h("strong", {}, mode.title),
          h("span", {}, mode.line),
        );
        option.addEventListener("click", () => {
          app.store.patch({ mode: mode.id });
          render();
          modes.querySelector<HTMLElement>(`[data-mode="${mode.id}"]`)?.focus();
        });
        return option;
      }),
    );
    decks.replaceChildren(
      ...app.content.decks.map((deck) => {
        const best = bestScore(saved, deck.id, saved.mode);
        const card = h(
          "button",
          { type: "button", class: "deck", "data-deck": deck.id },
          emblem(app, deck),
          h(
            "span",
            { class: "deck-text" },
            h("strong", { class: "deck-title" }, deck.title),
            deck.shared === null
              ? h("span", { class: "deck-note" }, "A handful from every deck")
              : h("span", { class: "deck-chars" }, ...deck.chars.map((char) => drawnChar(app.content.glyphs.get(char), char, "deck-char"))),
            h("span", { class: "deck-best" }, best === null ? "Not played yet" : `Best ${best}`),
          ),
        );
        card.addEventListener("click", () => actions.play(deck, app.store.get().mode));
        return card;
      }),
    );
  };
  render();

  return h(
    "main",
    { class: "screen home" },
    h(
      "header",
      { class: "home-head" },
      h("p", { class: "brand-kanji", lang: "ja", "aria-hidden": "true" }, "組木"),
      h("h1", {}, "Kumiki"),
      h("p", { class: "tagline" }, "Join the parts. Build the character."),
    ),
    modes,
    decks,
    h(
      "nav",
      { class: "home-actions", "aria-label": "More" },
      button("Exam", { class: "ghost", "data-action": "exam" }, actions.exam),
      button("Settings", { class: "ghost", "data-action": "settings" }, actions.settings),
      button("About", { class: "ghost", "data-action": "about" }, actions.about),
    ),
  );
}
