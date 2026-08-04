import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds src/embed.tsx as a single, dependency-free ES module — the drop-in
// bundle for embedding Write into a page that isn't part of this app (e.g.
// a Rails-rendered page with its own <head>/analytics). See README.md.
export default defineConfig({
  plugins: [react()],
  // Vite skips its usual process.env.NODE_ENV replacement in library mode
  // (libraries are normally re-bundled by a consumer's own build). This
  // bundle is a final standalone artifact, though, so without this define
  // react-dom's `process.env.NODE_ENV === "production" ? ... : ...` branch
  // survives untouched and throws "process is not defined" in the browser.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/embed.tsx"),
      name: "SubscriptWrite",
      formats: ["es"],
      fileName: () => "subscript-write.js",
    },
  },
});
