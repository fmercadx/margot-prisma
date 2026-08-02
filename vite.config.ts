import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* GitHub Pages serves this from /margot-prisma/, not from the domain root, so
   the base has to match or every asset URL 404s and the page renders blank.
   Local dev keeps '/'. */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/margot-prisma/' : '/',
  plugins: [react()],
}))
