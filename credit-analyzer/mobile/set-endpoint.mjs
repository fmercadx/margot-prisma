#!/usr/bin/env node
/* Point the app at a deployed licence service.
 *
 *   npm run set-endpoint -- https://credit-analyzer-licence.acme.workers.dev
 *   npm run set-endpoint -- https://licence.example.com --subscribe https://example.com/subscribe
 *
 * app.config.json is one small JSON file and could be edited by hand. This
 * exists because two hand-edits cost an afternoon each and neither announces
 * itself: dropping the /licence/verify path, so every sign-in 404s, and
 * leaving the scheme as http, which Android blocks outright and iOS refuses
 * under App Transport Security. Both surface on a device as "licence check
 * failed" with nothing pointing at the cause.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, 'app.config.json');
const VERIFY_PATH = '/licence/verify';

// Tokens the shipped config carries. The shell refuses to sign anyone in while
// one of these is still present, so they must never survive into a build.
const PLACEHOLDERS = /CHANGE-ME|YOUR-SUBDOMAIN|example\.(com|org)$/i;

export function resolveEndpoint(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a URL: ${input}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `The licence endpoint must be https, got ${url.protocol}//. ` +
      'Android blocks cleartext and iOS refuses it under App Transport Security.');
  }
  if (PLACEHOLDERS.test(url.hostname)) {
    throw new Error(`${url.hostname} is still a placeholder — use your own host.`);
  }
  // Accept the bare worker URL as well as the full path, since the deploy
  // output gives you the former and it is the obvious thing to paste.
  if (url.pathname === '/' || url.pathname === '') url.pathname = VERIFY_PATH;
  if (!url.pathname.endsWith(VERIFY_PATH)) {
    throw new Error(
      `Expected a URL ending in ${VERIFY_PATH}, got ${url.pathname}. ` +
      'Pass the bare worker URL and the path is added for you.');
  }
  return url.toString();
}

function main(argv) {
  const args = argv.slice(2);
  const endpoint = args.find((a) => !a.startsWith('--'));
  if (!endpoint) {
    console.error(
      'usage: npm run set-endpoint -- <licence-url> [--subscribe <url>]\n\n' +
      '  <licence-url>  the deployed worker, e.g.\n' +
      '                 https://credit-analyzer-licence.<subdomain>.workers.dev');
    return 1;
  }
  const subIdx = args.indexOf('--subscribe');
  const subscribe = subIdx === -1 ? null : args[subIdx + 1];

  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  cfg.licenceEndpoint = resolveEndpoint(endpoint);
  if (subscribe) cfg.subscribeUrl = subscribe;

  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

  console.log(`· licenceEndpoint  ${cfg.licenceEndpoint}`);
  console.log(`· subscribeUrl     ${cfg.subscribeUrl}`);
  if (PLACEHOLDERS.test(new URL(cfg.subscribeUrl).hostname)) {
    console.log('\n  subscribeUrl is still a placeholder. It is only the "no '
                + 'subscription yet?"\n  link on the sign-in screen, so the app '
                + 'works without it — but set it\n  with --subscribe before you '
                + 'ship.');
  }
  console.log('\nNext: npm run sync');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv));
  } catch (e) {
    console.error(`set-endpoint: ${e.message}`);
    process.exit(1);
  }
}
