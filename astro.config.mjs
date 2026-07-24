import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: 'https://nrbts.world',
  output: "hybrid",
  adapter: cloudflare()
});