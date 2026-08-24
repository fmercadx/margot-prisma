/* Static file server for the built site.
 *
 * Deliberately dependency-free. The site is a bundle of static assets, and a
 * marketing page for a care home is not a reason to take on an express tree and
 * its transitive updates. Node's own http and fs cover it in a hundred lines.
 *
 * Railway sets PORT; everything else has a working default. */

import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.txt', '.json', '.xml'])

/* Vite fingerprints everything under /assets/, so those are immutable. Anything
   else — index.html above all — must revalidate, or a deploy that changes the
   phone number leaves stale copies in browsers for a year. */
function cacheControl(pathname) {
  return pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate'
}

/** Resolves a URL path inside ROOT, or null if it tries to escape. */
function resolveInRoot(pathname) {
  const decoded = decodeURIComponent(pathname)
  const candidate = path.join(ROOT, decoded)
  const normalised = path.normalize(candidate)
  if (normalised !== ROOT && !normalised.startsWith(ROOT + path.sep)) return null
  return normalised
}

async function statFile(filePath) {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() ? stats : null
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed')
    return
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

  /* Railway's healthcheck hits this before the first real request. */
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }

  let filePath = resolveInRoot(pathname)
  if (!filePath) {
    res.writeHead(400).end('Bad Request')
    return
  }

  if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html')

  let stats = await statFile(filePath)

  /* Single-page site: anything that is not a real file falls back to the app
     shell, so a shared deep link keeps working. Missing assets still 404 —
     serving HTML for a missing .js only produces a confusing MIME error. */
  if (!stats) {
    if (path.extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found')
      return
    }
    filePath = path.join(ROOT, 'index.html')
    stats = await statFile(filePath)
    if (!stats) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Site has not been built')
      return
    }
  }

  const ext = path.extname(filePath).toLowerCase()
  const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(pathname) }).end()
    return
  }

  const headers = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': stats.size }).end()
    return
  }

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  const stream = createReadStream(filePath)
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })

  if (acceptsGzip && COMPRESSIBLE.has(ext)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
    stream.pipe(createGzip()).pipe(res)
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stats.size })
    stream.pipe(res)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`The Shepherd's Whisper — serving ${ROOT} on http://${HOST}:${PORT}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
