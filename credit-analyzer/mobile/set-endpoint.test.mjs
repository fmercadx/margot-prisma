/* Tests for the endpoint wiring.
 *
 *   node --test credit-analyzer/mobile/
 *
 * Every case here is a mistake that costs an afternoon on a device, because
 * all of them surface identically as "licence check failed".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEndpoint } from './set-endpoint.mjs';

test('a bare worker URL gets the verify path added', () => {
  assert.equal(
    resolveEndpoint('https://credit-analyzer-licence.acme.workers.dev'),
    'https://credit-analyzer-licence.acme.workers.dev/licence/verify');
});

test('a trailing slash is handled the same way', () => {
  assert.equal(
    resolveEndpoint('https://licence.margotanalytics.com/'),
    'https://licence.margotanalytics.com/licence/verify');
});

test('a full path is left alone', () => {
  const full = 'https://licence.margotanalytics.com/licence/verify';
  assert.equal(resolveEndpoint(full), full);
});

test('http is refused', () => {
  assert.throws(() => resolveEndpoint('http://licence.margotanalytics.com'),
                /must be https/);
});

test('a placeholder host is refused', () => {
  assert.throws(() => resolveEndpoint('https://licence.CHANGE-ME.example'),
                /placeholder/);
  assert.throws(
    () => resolveEndpoint('https://credit-analyzer-licence.YOUR-SUBDOMAIN.workers.dev'),
    /placeholder/);
});

test('a wrong path is refused rather than silently accepted', () => {
  assert.throws(
    () => resolveEndpoint('https://licence.margotanalytics.com/verify'),
    /Expected a URL ending in/);
});

test('junk is refused', () => {
  assert.throws(() => resolveEndpoint('licence.margotanalytics.com'), /Not a URL/);
  assert.throws(() => resolveEndpoint(''), /Not a URL/);
});
