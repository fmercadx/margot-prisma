#!/usr/bin/env node
/* Build the adult foster home site for GitHub Pages, into dist/shepherds-whisper.
 *
 *     npm run build:whisper
 *
 * Railway remains the real home for this site: it runs server.mjs, so the tour
 * form's /api/tour-request endpoint exists and enquiries reach the provider's
 * inbox. Pages is static, so that endpoint is absent — the wizard already
 * treats a 404 there as "no API here" and falls back to a prefilled email
 * rather than showing a visitor an error. The phone number works either way.
 *
 * Two things differ from the Railway build and both are handled here:
 *
 *   · the base path, since Pages serves this from a subdirectory beside the
 *     salon site and the analyzer rather than from a domain root
 *   · /privacy, which on Railway is the app shell served by server.mjs's
 *     fallback. Pages has no fallback, so the route needs a real file or a
 *     direct hit — the link in an email or a store listing — returns 404.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.join(ROOT, 'shepherds-whisper')
const BASE = '/margot-prisma/shepherds-whisper/'
const OUT = path.join(ROOT, 'dist', 'shepherds-whisper')

/** Routes that must exist as real files, because Pages will not fall back. */
const ROUTES = ['privacy']

const run = (cmd, args, env) =>
  execFileSync(cmd, args, { cwd: SITE, stdio: 'inherit', env: { ...process.env, ...env } })

if (!existsSync(path.join(SITE, 'node_modules'))) {
  console.log('installing shepherds-whisper dependencies')
  run('npm', ['ci'])
}

console.log(`building shepherds-whisper for Pages at ${BASE}`)
run('npm', ['run', 'build'], { SITE_BASE: BASE, SITE_OUT: path.relative(SITE, OUT) })

const shell = path.join(OUT, 'index.html')
if (!existsSync(shell)) throw new Error(`build produced no index.html at ${shell}`)

for (const route of ROUTES) {
  const dir = path.join(OUT, route)
  mkdirSync(dir, { recursive: true })
  copyFileSync(shell, path.join(dir, 'index.html'))
  console.log(`  wrote ${route}/index.html`)
}

/* Pages serves 404.html for anything unmatched. Handing it the app shell makes
   a mistyped or future route land on the site rather than on GitHub's error
   page; the router then renders the home page for a path it does not know. */
copyFileSync(shell, path.join(OUT, '404.html'))
console.log('  wrote 404.html')
