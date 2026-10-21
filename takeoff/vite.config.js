import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

/* The synthetic test sheet doubles as the page's "Try the sample plan" file,
   emitted beside index.html at build time so it is never a second copy. */
const samplePlan = {
  name: 'sample-plan',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'sample-plan.pdf',
      source: readFileSync(new URL('./test/fixtures/synthetic_plan.pdf', import.meta.url)),
    })
  },
}

/* A relative base, unlike the salon site's '/margot-prisma/': this page is
   served from /margot-prisma/takeoff/ on Pages and from / by smoke.py, and
   relative asset URLs work in both without a rebuild.

   The output goes into the repo-root dist/ beside the salon site and the
   analyzer, which is what deploy.yml uploads. Build it after `npm run build`
   at the root — Vite empties dist/ there. */
export default defineConfig({
  base: './',
  plugins: [samplePlan],
  build: {
    outDir: '../dist/takeoff',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
