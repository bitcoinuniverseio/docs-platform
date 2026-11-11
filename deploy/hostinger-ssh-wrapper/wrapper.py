#!/usr/bin/env python3
"""Deny-only prototype: protocol classification is not authorization to deploy."""
import os
import re
import sys
from pathlib import Path

ROOT = '/home/bitcoinuniverse/docs-releases'
SHA = re.compile(r'^[0-9a-f]{40}$')
HERE = Path(__file__).resolve().parent
LIMIT = 16384


def classify_script(data):
    if len(data) > LIMIT or b'\x00' in data:
        return None
    try:
        script = data.decode('ascii')
    except UnicodeDecodeError:
        return None
    lines = script.splitlines()
    if len(lines) < 4 or lines[0] != 'set -euo pipefail' or lines[1] != 'RELEASES="' + ROOT + '"':
        return None
    for name, field in (('deploy', 'SHA'), ('rollback', 'TARGET')):
        prefix = field + '="'
        if not lines[2].startswith(prefix) or not lines[2].endswith('"'):
            continue
        value = lines[2][len(prefix):-1]
        if not SHA.fullmatch(value) and not (name == 'rollback' and value == ''):
            continue
        template = (HERE / (name + '.template')).read_text(encoding='ascii')
        expected = template.replace('{RELEASES}', ROOT).replace('{' + field + '}', value).replace('{KEEP}', '5')
        if script == expected:
            return name, value
    return None


def main():
    # This prototype deliberately never performs an upload, shell command, or
    # filesystem mutation, including for classified requests.
    if os.environ.get('SSH_ORIGINAL_COMMAND') == 'bash -s':
        classify_script(sys.stdin.buffer.read(LIMIT + 1))
    print('docs wrapper: operation unavailable', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
