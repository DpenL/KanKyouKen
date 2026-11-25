/** What the game remembers between visits. */

import type { Stars } from "./progress";
import { sanitizeStars } from "./progress";
import type { Settings } from "./settings";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

/**
 * Storage key in plain play. A session opened with a link that names a study and a
 * participant, complete or not, keeps its settings and stars under a key of its own per
 * study and participant (`participantStoreKey`), so that participants who share a device
 * do not start from each other's choices.
 */
export const STORE_KEY = "kk.fude-uta.v1";

export interface Saved {
  readonly settings: Settings;
  /** Best stars per lesson id. */
  readonly stars: Readonly<Record<string, Stars>>;
}

export const DEFAULT_SAVED: Saved = { settings: DEFAULT_SETTINGS, stars: {} };

/**
 * What was read from storage, made safe to use: settings that are missing or unknown
 * fall back to their defaults, and only stars of 1, 2 or 3 are kept. Storage can hold
 * anything (an older version's data, a hand-edited value).
 */
export function cleanSaved(stored: Saved): Saved {
  const loose = stored as { readonly [K in keyof Saved]?: unknown };
  return { settings: sanitizeSettings(loose.settings), stars: sanitizeStars(loose.stars) };
}
