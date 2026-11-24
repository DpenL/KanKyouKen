import type { Lesson } from "@kankyouken/glyph-data";
import type { Stars } from "../progress";
import { button, el } from "./dom";

export interface HomeHandlers {
  onLesson(lesson: Lesson): void;
  onSettings(): void;
  onAbout(): void;
}

export function starRow(earned: number): HTMLElement {
  const row = el("span", { class: "stars", role: "img", "aria-label": `${earned} of 3 stars` });
  for (let i = 0; i < 3; i++) row.append(el("span", { class: "star", "data-earned": String(i < earned), "aria-hidden": "true" }, "★"));
  return row;
}

function lessonCard(lesson: Lesson, number: number, earned: number, onPick: () => void): HTMLElement {
  const card = el(
    "button",
    { type: "button", class: "lesson-card", "data-lesson": lesson.id },
    el("span", { class: "lesson-number" }, `Lesson ${number}`),
    el("span", { class: "lesson-title" }, lesson.title),
    el("span", { class: "lesson-chars", lang: "ja" }, lesson.chars.join(" ")),
    starRow(earned),
  );
  card.addEventListener("click", onPick);
  return card;
}

export function renderHome(
  lessons: readonly Lesson[],
  stars: Readonly<Record<string, Stars>>,
  handlers: HomeHandlers,
): HTMLElement {
  return el(
    "section",
    { class: "screen home" },
    el(
      "header",
      { class: "home-header" },
      el("p", { class: "home-kanji", lang: "ja", "aria-hidden": "true" }, "筆歌"),
      el("h1", { class: "home-title" }, "Fude Uta"),
      el("p", { class: "home-tagline" }, "Every stroke is a note. Write a character and hear its song."),
    ),
    el(
      "div",
      { class: "lesson-grid" },
      ...lessons.map((lesson, i) => lessonCard(lesson, i + 1, stars[lesson.id] ?? 0, () => handlers.onLesson(lesson))),
    ),
    el(
      "footer",
      { class: "home-footer" },
      button("Settings", handlers.onSettings, "quiet"),
      button("About", handlers.onAbout, "quiet"),
    ),
  );
}
