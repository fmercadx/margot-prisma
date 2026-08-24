import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* This site is served from the domain root by `server.mjs` on Railway, so the
   base stays '/'. It is deliberately not the salon site's '/margot-prisma/'
   base — that one exists because GitHub Pages serves it from a subpath. */
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
