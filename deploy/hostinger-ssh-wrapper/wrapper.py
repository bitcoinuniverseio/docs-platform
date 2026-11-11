#!/usr/bin/env python3
"""Forced command for the docs deployment identity. Requires Python >= 3.9."""
import fcntl
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path('/home/bitcoinuniverse/docs-releases')
HERE = Path(__file__).resolve().parent
SHA = re.compile(r'^[0-9a-f]{40}$')
UPLOAD = 256 * 1024 * 1024
EXPANDED = 1024 * 1024 * 1024
MEMBERS = 50000
PATH = re.compile(r'^/tmp/portal-([0-9a-f]{40})\.tgz$')
HOST = 'Host: docs.bitcoinuniverse.io'
URL = 'http://127.0.0.1'
STATUS = "curl -s -o /dev/null -w '%{http_code}' -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1"
CONTENT = "curl -s -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1/RELEASE"

class Refused(Exception):
    pass

def require(ok, msg='refused'):
    if not ok:
        raise Refused(msg)

def check_root(root):
    # Every ancestor is trusted and cannot be replaced by the deployment identity.
    root = Path(root)
    require(root.is_absolute() and os.path.normpath(str(root)) == str(root))
    for p in [root] + list(root.parents):
        st = os.lstat(p)
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022,
                'unsafe root or ancestor')
    return root

def read_regular(path, limit):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_size <= limit)
        with os.fdopen(fd, 'rb', closefd=False) as f:
            data = f.read(limit + 1)
        require(len(data) <= limit)
        return data
    finally:
        os.close(fd)

def current(root):
    p = root / 'current'
    if not os.path.lexists(p):
        return None
    require(p.is_symlink(), 'current is not a symlink')
    value = os.readlink(p)
    prefix = str(root) + '/'
    require(value.startswith(prefix) and SHA.fullmatch(value[len(prefix):]), 'invalid current')
    release(root, value[len(prefix):])
    return value[len(prefix):]

def release(root, sha):
    require(bool(SHA.fullmatch(sha)))
    p = root / sha
    st = os.lstat(p)
    require(stat.S_ISDIR(st.st_mode) and st.st_uid == os.geteuid() and not st.st_mode & 0o022, 'invalid release')
    require(read_regular(p / 'index.html', EXPANDED) is not None)
    return p

def switch(root, sha, old):
    release(root, sha)
    # The root is only writable by root; no other process may mutate it concurrently.
    tmp = root / 'current.new'
    require(not os.path.lexists(tmp), 'current.new already exists')
    os.symlink(str(root / sha), tmp)
    os.replace(tmp, root / 'current')
    fd, name = tempfile.mkstemp(prefix='.previous-', dir=str(root))
    try:
        with os.fdopen(fd, 'w') as f:
            f.write((str(root / old) if old else 'none') + '\n')
        os.replace(name, root / 'PREVIOUS')
    finally:
        if os.path.exists(name): os.unlink(name)

def extract(archive, stage, sha):
    total = 0
    seen = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for count, member in enumerate(tar, 1):
            require(count <= MEMBERS, 'too many members')
            name = member.name
            require('\x00' not in name and '\n' not in name and '\r' not in name and not name.startswith('/'))
            parts = name.split('/')
            while parts and parts[0] == '.': parts.pop(0)
            if not parts or parts == ['']:
                require(member.isdir()); continue
            if parts[-1] == '': parts.pop()
            require(parts and all(x not in ('', '.', '..') for x in parts))
            key = '/'.join(parts)
            require(key not in seen and (member.isdir() or member.isfile()), 'invalid archive member')
            seen.add(key)
            require(member.size >= 0 and member.size <= EXPANDED)
            total += member.size
            require(total <= EXPANDED, 'archive too large')
            dest = stage.joinpath(*parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                dest.mkdir(exist_ok=True)
                require(dest.is_dir() and not dest.is_symlink())
            else:
                source = tar.extractfile(member)
                require(source is not None)
                with open(dest, 'xb') as out:
                    shutil.copyfileobj(source, out, 65536)
                os.chmod(dest, 0o644)
    require(read_regular(stage / 'index.html', EXPANDED) is not None)
    require(read_regular(stage / 'RELEASE', 128).strip() == sha.encode(), 'RELEASE mismatch')

def deploy(root, sha):
    old = current(root)
    archive = root / ('.upload-' + sha)
    st = os.lstat(archive)
    require(stat.S_ISREG(st.st_mode) and st.st_size <= UPLOAD)
    stage = Path(tempfile.mkdtemp(prefix='.incoming-', dir=str(root)))
    os.chmod(stage, 0o755)
    try:
        extract(archive, stage, sha)
        dest = root / sha
        # Existing SHA directories are immutable; reuse them on retries.
        if os.path.lexists(dest):
            release(root, sha)
            require(read_regular(dest / 'RELEASE', 128).strip() == sha.encode())
        else:
            os.rename(stage, dest)
        switch(root, sha, old)
        os.unlink(archive)
        releases = []
        for p in root.iterdir():
            if SHA.fullmatch(p.name):
                st = os.lstat(p)
                require(stat.S_ISDIR(st.st_mode), 'unsafe retained release')
                releases.append((st.st_mtime_ns, p.name))
        releases.sort(reverse=True)
        keep = {name for _, name in releases[:5]} | {sha}
        if old: keep.add(old)
        for _, name in releases:
            if name not in keep: shutil.rmtree(root / name)
    finally:
        if stage.exists(): shutil.rmtree(stage)

def rollback(root, target):
    old = current(root)
    if not target:
        data = read_regular(root / 'PREVIOUS', 256).decode('ascii').rstrip('\n')
        prefix = str(root) + '/'
        require(data.startswith(prefix) and bool(SHA.fullmatch(data[len(prefix):])), 'invalid PREVIOUS')
        target = data[len(prefix):]
    require(bool(SHA.fullmatch(target)))
    switch(root, target, old)
    curl(['-s', '-o', '/dev/null', '-w', 'live status %{http_code}\n', '-H', HOST, URL + '/'])
    print('live release ', end='', flush=True)
    curl(['-s', '-H', HOST, URL + '/RELEASE'])
    print()

def curl(args):
    subprocess.run(['/usr/bin/curl'] + args, check=True, env={'PATH': '/usr/bin:/bin'})

def script(root, data):
    require(len(data) <= 16384 and b'\x00' not in data)
    for name in ('deploy', 'rollback'):
        template = (HERE / (name + '.template')).read_bytes().replace(b'{root}', str(root).encode())
        marker = b'{sha}' if name == 'deploy' else b'{target}'
        before, after = template.split(marker)
        if data.startswith(before) and data.endswith(after):
            value = data[len(before):len(data)-len(after)].decode('ascii')
            require(bool(SHA.fullmatch(value)) or (name == 'rollback' and value == ''))
            return name, value
    raise Refused('unknown script')

def line(stream, limit=1024):
    data = stream.readline(limit + 1)
    require(len(data) <= limit and data.endswith(b'\n') and b'\x00' not in data)
    return data[:-1]

def receive(root, sha, inp, out):
    # One SCP C record, one regular file, no directory or metadata operations.
    out.write(b'\0'); out.flush()
    header = line(inp)
    match = re.fullmatch(rb'C0[0-7]{3} ([0-9]{1,9}) ([A-Za-z0-9._-]{1,255})', header)
    require(match is not None, 'bad SCP header')
    size = int(match.group(1)); require(size <= UPLOAD)
    fd, name = tempfile.mkstemp(prefix='.uploading-', dir=str(root))
    try:
        out.write(b'\0'); out.flush()
        with os.fdopen(fd, 'wb') as f:
            left = size
            while left:
                chunk = inp.read(min(left, 65536))
                require(bool(chunk), 'truncated upload')
                f.write(chunk); left -= len(chunk)
        require(inp.read(1) == b'\0', 'bad SCP terminator')
        os.replace(name, root / ('.upload-' + sha))
        out.write(b'\0'); out.flush()
    finally:
        if os.path.exists(name): os.unlink(name)

def main():
    os.umask(0o022)
    root = check_root(ROOT)
    cmd = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    require('\n' not in cmd and '\r' not in cmd and '\x00' not in cmd)
    lockfd = os.open(str(root / '.wrapper.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lockfd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        match = re.fullmatch(r'scp -t (/tmp/portal-[0-9a-f]{40}\.tgz)', cmd)
        if match:
            receive(root, PATH.fullmatch(match.group(1)).group(1), sys.stdin.buffer, sys.stdout.buffer)
        elif cmd == 'bash -s':
            name, value = script(root, sys.stdin.buffer.read(16385))
            if name == 'deploy': deploy(root, value)
            else: rollback(root, value)
        elif cmd in [STATUS + p for p in ('/', '/protocols/', '/pagefind/pagefind.js', '/RELEASE')]:
            curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', HOST, URL + cmd[len(STATUS):]])
        elif cmd == CONTENT:
            curl(['-s', '-H', HOST, URL + '/RELEASE'])
        else:
            raise Refused('unknown command')

if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, ValueError, UnicodeError, tarfile.TarError, subprocess.SubprocessError) as exc:
        print('deployment refused: ' + str(exc), file=sys.stderr)
        sys.exit(1)
