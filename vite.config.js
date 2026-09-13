import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// package.json has "type": "module", so this file is loaded as an ES
// module — __dirname isn't defined here the way it would be in CommonJS,
// hence deriving it from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Relative base so the built site works whether it's served from a
// domain root (Netlify, Vercel, custom domain) or a GitHub Pages
// project subpath (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        player: resolve(__dirname, "player.html"),
        checker: resolve(__dirname, "checker.html"),
      },
    },
  },
});
