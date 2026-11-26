/* Where Chromium lives, resolved once for every script that needs a browser.
 *
 * The two environments differ and both must work. CI runs
 * `playwright install chromium`, which puts a browser where Playwright finds it
 * unaided — passing an executablePath there is not just unnecessary, it is
 * wrong. The pre-provisioned dev container has one at a fixed path instead and
 * disables downloads, so there it must be pointed at explicitly.
 *
 * This lived inline in three scripts and one of them hardcoded the container
 * path, which passed locally and failed on the first CI run that reached it.
 * One copy now.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const PW_BROWSERS = '/opt/pw-browsers'

/* The stable symlink the container maintains, pointing at whatever build is
   currently installed. The version-pinned path this used to hardcode
   (chromium-1194/chrome-linux/chrome) silently stopped existing when the image
   moved to 1243 — and the directory was renamed chrome-linux64 as well, so
   even the version-agnostic guess would have missed. Prefer the symlink; fall
   back to discovering the build only if it is gone. */
const STABLE = path.join(PW_BROWSERS, 'chromium')

function discover(exists) {
  try {
    for (const entry of readdirSync(PW_BROWSERS)) {
      if (!entry.startsWith('chromium-')) continue
      for (const dir of ['chrome-linux64', 'chrome-linux']) {
        const candidate = path.join(PW_BROWSERS, entry, dir, 'chrome')
        if (exists(candidate)) return candidate
      }
    }
  } catch {
    /* no such directory — we are not in the dev container */
  }
  return undefined
}

/**
 * @returns the executablePath to launch with, or undefined to let Playwright
 * resolve its own — which is the correct answer wherever it manages browsers.
 */
export function chromiumExecutablePath({
  argv = process.argv,
  env = process.env,
  exists = existsSync,
} = {}) {
  const flag = argv.indexOf('--browser')
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1]
  if (env.PW_CHROMIUM) return env.PW_CHROMIUM
  if (exists(STABLE)) return STABLE
  return discover(exists)
}

export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright')
  return chromium.launch({
    executablePath: chromiumExecutablePath(),
    args: ['--no-sandbox'],
    ...options,
  })
}
