import { defineConfig } from 'vite'

/* A relative base, unlike the salon site's '/margot-prisma/': this page is
   served from /margot-prisma/takeoff/ on Pages and from / by smoke.py, and
   relative asset URLs work in both without a rebuild.

   The output goes into the repo-root dist/ beside the salon site and the
   analyzer, which is what deploy.yml uploads. Build it after `npm run build`
   at the root — Vite empties dist/ there. */
export default defineConfig({
  base: './',
  build: {
    outDir: '../dist/takeoff',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
