#!/usr/bin/env python3
"""Install the iOS Simulator build and check it works.

Run by .github/workflows/personal-daily-hub-ios.yml on a macOS runner after
the app is built for the Simulator. Needs Xcode's `xcrun simctl` and
Maestro (`maestro` on PATH). Standard library only.

What it proves, on a real iOS runtime rather than in Jest:

  1. The app installs and draws its home screen (no crash at launch, the
     native modules all load).
  2. A note typed into Quick Capture is still there after the app is
     closed and opened again: storage, the encryption key in the Keychain,
     and decryption all work end to end (scripts/ios-smoke.yaml).
  3. On disk it is ciphertext: the app's data container holds sealed values
     ("pdh1:") and neither the note's text nor any plaintext field names.
  4. No crash report names the app, and it is still running at the end.

Screenshots, the flow's output and the system log go to --out, which CI
uploads.
"""

import argparse
import glob
import json
import os
import subprocess
import sys
import time

BUNDLE = 'com.fmercadx.personaldailyhub'
NOTE = 'Simulator check'
FIELD_NAMES = ['"habitsDone"', '"notes"', '"text"', '"expenses"', '"waterGoal"']
HERE = os.path.dirname(os.path.abspath(__file__))

failures = []


def check(ok, what):
    print(('PASS  ' if ok else 'FAIL  ') + what, flush=True)
    if not ok:
        failures.append(what)


def run(*args, check_rc=True, timeout=600, **kw):
    r = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout, **kw)
    if check_rc and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed ({r.returncode}):\n{r.stdout}\n{r.stderr}")
    return r


def pick_iphone():
    """The newest iOS runtime's first available iPhone."""
    data = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j').stdout)
    best = None
    for runtime, devices in data['devices'].items():
        if 'iOS' not in runtime:
            continue
        version = tuple(int(x) for x in runtime.rsplit('iOS-', 1)[-1].split('-') if x.isdigit())
        for d in devices:
            if d['name'].startswith('iPhone') and (best is None or version > best[0]):
                best = (version, d)
                break
    if best is None:
        raise RuntimeError('No iPhone simulator is available')
    return best[1]


def dump_screen(udid, out):
    """What Maestro can see on screen now: every label, text and id, for the log."""
    r = run('maestro', '--device', udid, 'hierarchy', check_rc=False, timeout=300)
    with open(os.path.join(out, 'hierarchy.json'), 'w') as f:
        f.write(r.stdout)
    seen = []

    def walk(node):
        if isinstance(node, dict):
            attrs = node.get('attributes') or {}
            for k in ('accessibilityText', 'text', 'resource-id', 'value', 'hintText'):
                v = attrs.get(k)
                if v and (k, v) not in seen:
                    seen.append((k, v))
            for child in node.get('children') or []:
                walk(child)

    try:
        start = r.stdout.index('{')
        walk(json.loads(r.stdout[start:]))
    except (ValueError, json.JSONDecodeError):
        print('Could not read the hierarchy:', r.stdout[-2000:], r.stderr[-2000:], flush=True)
        return
    print('On screen now:', flush=True)
    for k, v in seen[:200]:
        print(f'  {k}: {v}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True, help='the .app built for the iOS Simulator')
    ap.add_argument('--out', required=True)
    ap.add_argument('--udid', help='a simulator to use instead of the newest iPhone')
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)

    if a.udid:
        udid = a.udid
    else:
        device = pick_iphone()
        udid = device['udid']
        print(f"Simulator: {device['name']} ({udid})", flush=True)
    run('xcrun', 'simctl', 'boot', udid, check_rc=False)
    run('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=900)

    run('xcrun', 'simctl', 'install', udid, a.app)
    check(True, 'app installed')

    started = time.time()
    # Maestro keeps screenshots inside its output folder; make that --out.
    flow = run(
        'maestro', '--device', udid, 'test', '--test-output-dir', out, os.path.join(HERE, 'ios-smoke.yaml'),
        check_rc=False, timeout=1200,
    )
    with open(os.path.join(out, 'maestro.log'), 'w') as f:
        f.write(flow.stdout + '\n' + flow.stderr)
    print(flow.stdout[-4000:], flush=True)
    check(flow.returncode == 0, 'home screen drawn, note added, and still there after closing and reopening the app')
    if flow.returncode != 0:
        dump_screen(udid, out)

    run('xcrun', 'simctl', 'io', udid, 'screenshot', os.path.join(out, '4-final.png'), check_rc=False)

    # The data container: AsyncStorage keeps its values in files under Library.
    container = run('xcrun', 'simctl', 'get_app_container', udid, BUNDLE, 'data').stdout.strip()
    blobs = []
    for path in glob.glob(os.path.join(container, '**', '*'), recursive=True):
        if os.path.isfile(path) and os.path.getsize(path) < 20_000_000:
            with open(path, 'rb') as f:
                blobs.append((path, f.read()))
    stored = b'\n'.join(b for _, b in blobs)
    print(f'Data container: {len(blobs)} files', flush=True)
    check(b'pdh1:' in stored, 'stored values are sealed (pdh1: prefix present)')
    check(NOTE.encode() not in stored, f'the note text "{NOTE}" does not appear anywhere in the data container')
    leaked = [n for n in FIELD_NAMES if n.encode() in stored]
    check(not leaked, 'no plaintext JSON field names in the data container' + (f' (found {leaked})' if leaked else ''))

    alive = run('xcrun', 'simctl', 'spawn', udid, 'launchctl', 'list', check_rc=False).stdout
    check(f'UIKitApplication:{BUNDLE}' in alive, 'app process is alive')

    reports = [
        p
        for p in glob.glob(os.path.expanduser('~/Library/Logs/DiagnosticReports/*'))
        if 'PersonalDailyHub' in os.path.basename(p) and os.path.getmtime(p) >= started - 5
    ]
    check(not reports, 'no crash report for the app' + (f' ({reports})' if reports else ''))

    log = run(
        'xcrun', 'simctl', 'spawn', udid, 'log', 'show', '--last', '15m', '--style', 'compact',
        '--predicate', 'process == "PersonalDailyHub"', check_rc=False, timeout=300,
    )
    with open(os.path.join(out, 'system.log'), 'w') as f:
        f.write(log.stdout)

    if failures:
        print(f'SMOKE FAILED: {len(failures)} check(s)')
        sys.exit(1)
    print('SMOKE OK')


if __name__ == '__main__':
    main()
