import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Two hosts, two base paths, one build.
 *
 * Railway serves this at a domain root through `server.mjs`, so the default
 * base is '/'. GitHub Pages serves it from a subpath beside the salon site and
 * the analyzer, so `pages-build.mjs` sets SITE_BASE and SITE_OUT. Neither host
 * is the odd one out — the base simply belongs to the deploy, not the site. */
export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [react()],
  build: {
    outDir: process.env.SITE_OUT ?? 'dist',
    /* SITE_OUT points outside this package, which Vite refuses to empty
       unless told explicitly. It is a directory we own, so this is safe. */
    emptyOutDir: true,
    sourcemap: false,
  },
})
