/**
 * Engine-agnostic mechanics for character-learning games.
 *
 * Each area is also available on its own subpath (`@kankyouken/mechanics/stroke`, ...),
 * which is the better import for hosts that only need one of them.
 */
export * as util from "./util";
export * as glyph from "./glyph";
export * as stroke from "./stroke";
export * as melody from "./melody";
export * as scaffold from "./scaffold";
export * as components from "./components";
export * as telemetry from "./telemetry";
