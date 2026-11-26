#!/usr/bin/env python3
"""Install the release APK on a running Android emulator and check it works.

Run by .github/workflows/personal-daily-hub-android.yml after the APK is
built; needs `adb` on PATH and one booted emulator. Standard library only.

What it proves, on a real Android runtime rather than in Jest:

  1. The app installs and draws its home screen (no crash at launch, the
     native modules all load).
  2. A note typed into Quick Capture is still there after the app is killed
     and started again: storage, the encryption key in the Keystore, and
     decryption all work end to end.
  3. On disk it is ciphertext: reading the app's database as root finds
     sealed values ("pdh1:") and not the note's text.
  4. The installed app holds no INTERNET permission.
  5. Nothing in logcat says the app crashed.

Screenshots, UI dumps and logcat go to --out, which CI uploads.
"""

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PKG = 'com.fmercadx.personaldailyhub'
NOTE = 'Emulator check'
OUT = '.'


def adb(*args, check=True, binary=False, timeout=120):
    r = subprocess.run(['adb', *args], capture_output=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout if binary else r.stdout.decode(errors='replace')


def save(name, data):
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(os.path.join(OUT, name), mode) as f:
        f.write(data)


def dump_ui(name):
    adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml', check=False)
    xml = adb('exec-out', 'cat', '/sdcard/ui.xml', check=False)
    save(name, xml)
    return xml


def nodes(xml):
    try:
        return list(ET.fromstring(xml).iter('node'))
    except ET.ParseError:
        return []


def find(xml, text=None, desc=None):
    for n in nodes(xml):
        if text is not None and n.get('text') == text:
            return n
        if desc is not None and n.get('content-desc') == desc:
            return n
    return None


def visible_strings(xml):
    seen = []
    for n in nodes(xml):
        for attr in ('text', 'content-desc'):
            v = (n.get(attr) or '').strip()
            if v and v not in seen:
                seen.append(v)
    return seen


def wait_for(name, timeout=90, **query):
    deadline = time.time() + timeout
    xml = ''
    while time.time() < deadline:
        xml = dump_ui(name)
        node = find(xml, **query)
        if node is not None:
            return node, xml
        time.sleep(2)
    print('Last screen showed:', visible_strings(xml))
    raise TimeoutError(f'Never saw {query} within {timeout}s')


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def screenshot(name):
    save(name, adb('exec-out', 'screencap', '-p', binary=True))


def launch():
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')


def check(ok, what):
    print(('PASS  ' if ok else 'FAIL  ') + what)
    if not ok:
        raise AssertionError(what)


def read_app_files_as_root():
    """The app's database files, read as root (google_apis images allow it)."""
    adb('root', check=False)
    time.sleep(3)
    adb('wait-for-device')
    listing = adb('shell', 'ls', f'/data/data/{PKG}/databases/')
    print('Databases:', listing.split())
    blobs = {}
    for name in listing.split():
        if name.startswith('RKStorage'):
            blobs[name] = adb('exec-out', 'cat', f'/data/data/{PKG}/databases/{name}', binary=True)
    return blobs


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    OUT = args.out
    os.makedirs(OUT, exist_ok=True)

    adb('wait-for-device')
    adb('install', '-r', args.apk, timeout=300)
    adb('logcat', '-c', check=False)

    try:
        # 1. Launch and draw the home screen.
        launch()
        _, xml = wait_for('1-home.xml', text='Quick Capture')
        time.sleep(1)
        screenshot('1-home.png')
        strings = visible_strings(xml)
        print('Home screen shows:', strings[:40])
        check(all(s in strings for s in ('Quick Capture', 'Habits')), 'home screen rendered')

        # 2. Add a note.
        field, _ = wait_for('2-before-note.xml', desc='New note')
        tap(field)
        time.sleep(1)
        adb('shell', 'input', 'text', NOTE.replace(' ', '%s'))
        save_btn, _ = wait_for('2-typed.xml', desc='Save note')
        tap(save_btn)
        wait_for('2-note.xml', text=NOTE)
        screenshot('2-note.png')
        check(True, 'note added')

        # Background the app (it writes immediately), then kill and restart it.
        time.sleep(1)
        adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
        time.sleep(2)
        adb('shell', 'am', 'force-stop', PKG)
        time.sleep(1)
        launch()
        wait_for('3-restarted.xml', text=NOTE)
        time.sleep(1)
        screenshot('3-after-restart.png')
        check(True, 'note survived a force-stop and restart (decrypted with the Keystore key)')

        # 3. On disk it is ciphertext.
        blobs = read_app_files_as_root()
        joined = b''.join(blobs.values())
        check(len(blobs) > 0, 'found the app database')
        check(b'pdh1:' in joined, 'stored values are sealed (pdh1: prefix present)')
        check(NOTE.encode() not in joined, f'the note text "{NOTE}" does not appear anywhere in the database files')
        check(b'"notes"' not in joined, 'no plaintext JSON field names in the database files')

        # 4. No internet permission at all.
        pkg_dump = adb('shell', 'dumpsys', 'package', PKG)
        save('package.txt', pkg_dump)
        check('android.permission.INTERNET' not in pkg_dump, 'installed app has no INTERNET permission')

        # 5. Still running, no crash.
        pid = adb('shell', 'pidof', PKG, check=False).strip()
        check(bool(pid), f'app process is alive (pid {pid})')
    finally:
        log = adb('logcat', '-d', check=False)
        save('logcat.txt', log)

    crashes = [l for l in log.splitlines() if 'FATAL EXCEPTION' in l or (f'Process: {PKG}' in l)]
    check(not crashes, 'no crash in logcat' + ('' if not crashes else f': {crashes[:3]}'))
    print('SMOKE OK')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001 - report any failure as a CI error
        print(f'::error::Android smoke test failed: {e}')
        sys.exit(1)
