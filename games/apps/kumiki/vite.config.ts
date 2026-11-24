import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs, so the build can be hosted under any path.
  base: "./",
  build: { target: "es2022" },
});
