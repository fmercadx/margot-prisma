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

import { existsSync } from 'node:fs'

const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

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
  return exists(PREINSTALLED) ? PREINSTALLED : undefined
}

export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright')
  return chromium.launch({
    executablePath: chromiumExecutablePath(),
    args: ['--no-sandbox'],
    ...options,
  })
}
