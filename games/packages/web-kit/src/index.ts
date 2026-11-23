/**
 * Browser adapters for `@kankyouken/mechanics`: Web Audio voices, pointer capture, SVG
 * glyph rendering and the KanKyouKen event-collector sink. Everything that needs a DOM
 * lives here so that the mechanics stay engine-agnostic.
 */
export * from "./audio";
export * from "./input";
export * from "./render";
export * from "./telemetry";
