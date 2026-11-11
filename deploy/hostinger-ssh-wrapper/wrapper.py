#!/usr/bin/env python3
"""Forced command for the docs deployment identity. Never interprets client shell."""
import fcntl
import io
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path('/var/www/docs-releases')
TEMPLATES = Path(__file__).resolve().parent
SHA = re.compile(r'^[0-9a-f]{40}$')
UPLOAD = re.compile(r'^scp -t /tmp/portal-([0-9a-f]{40})\.tgz$')
MAX_UPLOAD = 256 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024
MAX_MEMBERS = 50000
MAX_SCRIPT = 16384
CURL = '/usr/bin/curl'
OWNER_UID = 0
HOST = 'Host: docs.bitcoinuniverse.io'
PATHS = ('/', '/protocols/', '/pagefind/pagefind.js', '/RELEASE')
STATUS = "curl -s -o /dev/null -w '%{http_code}' -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1"
CONTENT = "curl -s -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1/RELEASE"

class Refused(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Refused(message)

def root_check():
    # All path operations rely on this directory and every ancestor being controlled
    # by the wrapper's effective uid and not writable by anyone else.
    path = ROOT
    while True:
        st = os.lstat(str(path))
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == OWNER_UID and not st.st_mode & 0o022,
                'unsafe root or ancestor')
        if path == path.parent:
            break
        path = path.parent

def regular(path):
    try:
        return stat.S_ISREG(os.lstat(str(path)).st_mode)
    except FileNotFoundError:
        return False

def release_path(value):
    require(bool(SHA.fullmatch(value)), 'invalid release')
    return ROOT / value

def safe_release(path):
    st = os.lstat(str(path))
    require(stat.S_ISDIR(st.st_mode) and st.st_uid == OWNER_UID and st.st_mode & 0o7777 == 0o755, 'unsafe release directory')
    for base, dirs, files in os.walk(str(path), followlinks=False):
        for name in dirs + files:
            st = os.lstat(os.path.join(base, name))
            mode = 0o755 if stat.S_ISDIR(st.st_mode) else 0o644
            require((stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)) and st.st_uid == OWNER_UID and st.st_mode & 0o7777 == mode, 'unsafe release content')

def current():
    p = ROOT / 'current'
    try:
        st = os.lstat(str(p))
    except FileNotFoundError:
        return 'none'
    require(stat.S_ISLNK(st.st_mode), 'current is not a symlink')
    value = os.readlink(str(p))
    require(value.startswith(str(ROOT) + '/') and SHA.fullmatch(value[len(str(ROOT))+1:]), 'invalid current')
    p = release_path(value[len(str(ROOT))+1:])
    safe_release(p)
    return value

def previous():
    p = ROOT / 'PREVIOUS'
    require(regular(p), 'invalid PREVIOUS')
    with open(str(p), 'rb') as f:
        data = f.read(256)
    try:
        value = data.decode('ascii')
    except UnicodeDecodeError:
        raise Refused('invalid PREVIOUS')
    require(value.endswith('\n') and value.count('\n') == 1, 'invalid PREVIOUS')
    value = value[:-1]
    if value == 'none':
        return 'none'
    require(value.startswith(str(ROOT) + '/') and SHA.fullmatch(value[len(str(ROOT))+1:]), 'invalid PREVIOUS')
    return value[len(str(ROOT))+1:]

def switch(sha):
    dest = release_path(sha)
    require(dest.is_dir() and not dest.is_symlink() and regular(dest / 'index.html'), 'invalid destination')
    safe_release(dest)
    old = current()
    if os.path.lexists(str(ROOT / 'PREVIOUS')):
        previous()
    # Unique files avoid following or replacing attacker-provided current.new.
    fd, tmp = tempfile.mkstemp(prefix='.previous-', dir=str(ROOT))
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(old + '\n')
        link = tmp + '.link'
        os.symlink(str(dest), link)
        os.replace(link, str(ROOT / 'current'))
        os.replace(tmp, str(ROOT / 'PREVIOUS'))
    finally:
        for p in (tmp, tmp + '.link'):
            if os.path.lexists(p):
                os.unlink(p)
    print('swapped: {} -> {}'.format(old, dest))

def extract(archive, stage, sha):
    total = 0
    seen = set()
    with tarfile.open(str(archive), 'r:gz') as tar:
        for count, member in enumerate(tar, 1):
            require(count <= MAX_MEMBERS, 'too many members')
            name = member.name
            require('\x00' not in name and '\n' not in name and not name.startswith('/'), 'bad member name')
            parts = name.split('/')
            require(all(x not in ('..',) for x in parts), 'traversal')
            parts = [x for x in parts if x not in ('', '.')]
            if not parts:
                require(member.isdir(), 'invalid root member')
                continue
            key = '/'.join(parts)
            require(key not in seen, 'duplicate member')
            seen.add(key)
            require(member.isdir() or member.isfile(), 'links and special files forbidden')
            require(len(key) <= 4096 and all(len(x.encode()) <= 255 for x in parts), 'path too long')
            target = stage.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            else:
                total += member.size
                require(member.size >= 0 and total <= MAX_EXPANDED, 'archive too large')
                src = tar.extractfile(member)
                require(src is not None, 'bad archive')
                with open(str(target), 'xb') as out:
                    shutil.copyfileobj(src, out, 1024 * 1024)
                os.chmod(str(target), 0o644)
    require(regular(stage / 'index.html') and regular(stage / 'RELEASE'), 'missing release files')
    with open(str(stage / 'RELEASE'), 'rb') as f:
        require(f.read(128) == (sha + '\n').encode(), 'wrong release marker')
    # mkdir(parents=True) is affected by the inherited umask, including for
    # implicit parents that never occur as explicit archive members.
    for base, dirs, files in os.walk(str(stage), topdown=False, followlinks=False):
        for name in files:
            os.chmod(os.path.join(base, name), 0o644)
        for name in dirs:
            os.chmod(os.path.join(base, name), 0o755)
        os.chmod(base, 0o755)

def deploy(sha):
    release_path(sha)
    archive = ROOT / ('.upload-' + sha)
    require(regular(archive), 'missing upload')
    require(os.lstat(str(archive)).st_size <= MAX_UPLOAD, 'upload too large')
    stage = Path(tempfile.mkdtemp(prefix='.incoming-', dir=str(ROOT)))
    try:
        os.chmod(str(stage), 0o755)
        extract(archive, stage, sha)
        dest = release_path(sha)
        # Never replace an existing release: current readers and rollback retain it.
        require(not os.path.lexists(str(dest)), 'release already exists')
        os.rename(str(stage), str(dest))
        os.unlink(str(archive))
        switch(sha)
        releases = []
        for p in ROOT.iterdir():
            if SHA.fullmatch(p.name):
                st = os.lstat(str(p))
                require(stat.S_ISDIR(st.st_mode), 'invalid retained release')
                releases.append((st.st_mtime_ns, p))
        releases.sort(key=lambda item: item[0], reverse=True)
        protected = {sha, os.path.basename(current())}
        prev = previous()
        protected.add(prev)
        for _, p in releases[5:]:
            if p.name not in protected:
                shutil.rmtree(str(p))
    finally:
        if stage.exists():
            shutil.rmtree(str(stage))

def rollback(target):
    target = target or previous()
    require(target != 'none', 'no previous release')
    switch(target)
    status = subprocess.check_output([CURL, '-s', '-o', '/dev/null', '-w', 'live status %{http_code}\n', '-H', HOST, 'http://127.0.0.1/'])
    live = subprocess.check_output([CURL, '-s', '-H', HOST, 'http://127.0.0.1/RELEASE'])
    sys.stdout.buffer.write(status + b'live release ' + live.rstrip(b'\n') + b'\n')

def read_line(stream, limit):
    line = stream.readline(limit + 1)
    require(len(line) <= limit and line.endswith(b'\n'), 'invalid protocol line')
    return line

def upload(sha, inp, out):
    out.write(b'\0'); out.flush()
    line = read_line(inp, 1024)
    m = re.fullmatch(rb'C[0-7]{4} ([0-9]{1,10}) ([^/\x00\r\n]+)\n', line)
    require(m is not None, 'invalid SCP header')
    size = int(m.group(1))
    require(0 < size <= MAX_UPLOAD and not m.group(2).startswith(b'-'), 'invalid upload')
    fd, temp = tempfile.mkstemp(prefix='.upload-tmp-', dir=str(ROOT))
    try:
        out.write(b'\0'); out.flush()
        with os.fdopen(fd, 'wb') as f:
            remaining = size
            while remaining:
                block = inp.read(min(remaining, 1024 * 1024))
                require(bool(block), 'truncated upload')
                f.write(block)
                remaining -= len(block)
        require(inp.read(1) == b'\0', 'invalid upload terminator')
        os.replace(temp, str(ROOT / ('.upload-' + sha)))
        out.write(b'\0'); out.flush()
    finally:
        if os.path.exists(temp): os.unlink(temp)

def main():
    os.umask(0o022)
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    require('\n' not in command and '\x00' not in command, 'invalid command')
    root_check()
    with open(str(ROOT / '.wrapper.lock'), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        m = UPLOAD.fullmatch(command)
        if m:
            upload(m.group(1), sys.stdin.buffer, sys.stdout.buffer)
        elif command == 'bash -s':
            data = sys.stdin.buffer.read(MAX_SCRIPT + 1)
            require(len(data) <= MAX_SCRIPT, 'script too large')
            deploy_template = (TEMPLATES / 'deploy.template').read_bytes()
            rollback_template = (TEMPLATES / 'rollback.template').read_bytes()
            match = re.search(rb'\nSHA="([0-9a-f]{40})"\n', data)
            target = re.search(rb'\nTARGET="([0-9a-f]{40}|)"\n', data)
            if match and data == deploy_template.replace(b'{sha}', match.group(1)):
                deploy(match.group(1).decode())
            elif target and data == rollback_template.replace(b'{target}', target.group(1)):
                rollback(target.group(1).decode())
            else:
                raise Refused('unrecognized script')
        elif command in tuple(STATUS + p for p in PATHS):
            p = command[len(STATUS):]
            sys.stdout.buffer.write(subprocess.check_output([CURL, '-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', HOST, 'http://127.0.0.1' + p]))
        elif command == CONTENT:
            sys.stdout.buffer.write(subprocess.check_output([CURL, '-s', '-H', HOST, 'http://127.0.0.1/RELEASE']))
        else:
            raise Refused('command refused')

if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as exc:
        print('deployment refused: {}'.format(exc), file=sys.stderr)
        sys.exit(1)
