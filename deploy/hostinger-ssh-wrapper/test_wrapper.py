import importlib.util
import io
import os
import stat
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('wrapper', HERE / 'wrapper.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
A, B = 'a' * 40, 'b' * 40

class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        w.ROOT = Path(self.tmp.name)
        self.safe = mock.patch.object(w, 'safe_release')
        self.safe.start()
        self.addCleanup(self.safe.stop)
    def archive(self, sha, extra=()):
        p = w.ROOT / ('.upload-' + sha)
        with tarfile.open(str(p), 'w:gz') as tar:
            for name, data, kind in [('index.html', b'hi', None), ('RELEASE', (sha+'\n').encode(), None)] + list(extra):
                info = tarfile.TarInfo(name)
                if kind:
                    info.type = kind
                    info.linkname = '/etc/passwd'
                else:
                    info.size = len(data)
                tar.addfile(info, io.BytesIO(data) if not kind else None)
        return p
    def test_upload_and_deploy_switch_and_rollback(self):
        p = self.archive(A)
        data = p.read_bytes(); p.unlink()
        out = io.BytesIO()
        w.upload(A, io.BytesIO(b'C0600 %d file.tgz\n' % len(data) + data + b'\0'), out)
        self.assertEqual(out.getvalue(), b'\0\0\0')
        w.deploy(A)
        self.archive(B); w.deploy(B)
        self.assertEqual(os.readlink(str(w.ROOT/'current')), str(w.ROOT/B))
        self.assertEqual(w.previous(), A)
        with mock.patch.object(w.subprocess, 'check_output', side_effect=[b'live status 200\n', A.encode()+b'\n']) as call:
            w.rollback('')
        self.assertEqual(os.readlink(str(w.ROOT/'current')), str(w.ROOT/A))
        self.assertEqual(w.previous(), B)
        self.assertEqual(call.call_args_list[0].args[0], [w.CURL, '-s', '-o', '/dev/null', '-w', 'live status %{http_code}\n', '-H', w.HOST, 'http://127.0.0.1/'])
        with mock.patch.object(w.subprocess, 'check_output', side_effect=[b'200', B.encode()]): w.rollback(B)
        self.assertEqual(w.previous(), A)
    def test_archive_traversal_and_links_rejected(self):
        for name, kind in [('../escape', None), ('/absolute', None), ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE)]:
            with self.subTest(name=name):
                self.archive(A, [(name, b'x', kind)])
                with self.assertRaises(w.Refused): w.deploy(A)
                self.assertFalse((w.ROOT/A).exists())
    def test_restrictive_umask_produces_readable_release(self):
        self.safe.stop()
        with mock.patch.object(w, 'OWNER_UID', os.geteuid()):
            self.archive(A, [('nested/deep/file.txt', b'content', None)])
            old = os.umask(0o077)
            try:
                w.deploy(A)
            finally:
                os.umask(old)
            root = w.ROOT / A
            for base, dirs, files in os.walk(str(root)):
                self.assertEqual(stat.S_IMODE(os.stat(base).st_mode), 0o755)
                for name in dirs:
                    self.assertEqual(stat.S_IMODE(os.stat(os.path.join(base, name)).st_mode), 0o755)
                for name in files:
                    self.assertEqual(stat.S_IMODE(os.stat(os.path.join(base, name)).st_mode), 0o644)
            self.assertEqual(os.readlink(str(w.ROOT / 'current')), str(root))
    def test_real_release_validation_rejects_symlinks_and_unreadable_content(self):
        self.safe.stop()
        with mock.patch.object(w, 'OWNER_UID', os.geteuid()):
            self.archive(A); w.deploy(A)
            release = w.ROOT / A
            (release / 'link').symlink_to('/etc/passwd')
            with self.assertRaises(w.Refused): w.current()
            (release / 'link').unlink()
            (release / 'index.html').chmod(0o600)
            with self.assertRaises(w.Refused): w.current()
    def test_invalid_archive_and_failed_switch_do_not_publish_partial_tree(self):
        self.archive(A); w.deploy(A)
        self.archive(B, [('nested/../../escape', b'x', None)])
        with self.assertRaises(w.Refused): w.deploy(B)
        self.assertEqual(os.readlink(str(w.ROOT/'current')), str(w.ROOT/A))
        self.assertFalse((w.ROOT/B).exists())
        self.assertFalse(list(w.ROOT.glob('.incoming-*')))
        self.archive(B)
        with mock.patch.object(w.os, 'replace', side_effect=OSError('switch failed')):
            with self.assertRaises(OSError): w.deploy(B)
        self.assertEqual(os.readlink(str(w.ROOT/'current')), str(w.ROOT/A))
        self.assertEqual((w.ROOT/B/'RELEASE').read_text(), B+'\n')
        self.assertFalse(list(w.ROOT.glob('.previous-*')))
    def test_limits_and_duplicate(self):
        self.archive(A, [('index.html', b'bad', None)])
        with self.assertRaises(w.Refused): w.deploy(A)
        self.archive(A)
        with mock.patch.object(w, 'MAX_EXPANDED', 1):
            with self.assertRaises(w.Refused): w.deploy(A)
        with mock.patch.object(w, 'MAX_UPLOAD', 1):
            with self.assertRaises(w.Refused): w.upload(A, io.BytesIO(b'C0644 2 x\n'), io.BytesIO())
    def test_malicious_state(self):
        (w.ROOT/'current').symlink_to('/etc')
        with self.assertRaises(w.Refused): w.current()
        (w.ROOT/'PREVIOUS').write_text('/etc/passwd\n')
        with self.assertRaises(w.Refused): w.previous()
    def test_retention(self):
        for i in range(7):
            sha = format(i, '040x')
            self.archive(sha); w.deploy(sha)
        self.assertEqual(len([p for p in w.ROOT.iterdir() if w.SHA.fullmatch(p.name)]), 5)
    def test_exact_script_and_command_gates(self):
        class Input:
            def __init__(self, b): self.buffer = io.BytesIO(b)
        for name, key, value in [('deploy', b'{sha}', A.encode()), ('rollback', b'{target}', b'')]:
            script = (HERE/(name+'.template')).read_bytes().replace(key, value)
            with mock.patch.object(w, 'root_check'), mock.patch.object(w, name) as action, mock.patch.object(w.sys, 'stdin', Input(script)), mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND':'bash -s'}):
                w.main(); action.assert_called_once()
            with mock.patch.object(w, 'root_check'), mock.patch.object(w.sys, 'stdin', Input(script+b'echo evil\n')), mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND':'bash -s'}):
                with self.assertRaises(w.Refused): w.main()
        for command in ['id', 'sftp', 'scp -t /etc/passwd', 'bash -s\nwhoami', w.CONTENT + ';id']:
            with mock.patch.object(w, 'root_check'), mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND':command}):
                with self.assertRaises(w.Refused): w.main()
    def test_fixed_curl_commands(self):
        class Output:
            def __init__(self): self.buffer = io.BytesIO()
        for path in w.PATHS:
            output = Output()
            with mock.patch.object(w, 'root_check'), mock.patch.object(w.subprocess, 'check_output', return_value=b'200') as call, mock.patch.object(w.sys, 'stdout', output), mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': w.STATUS + path}):
                w.main()
            self.assertEqual(output.buffer.getvalue(), b'200')
            self.assertEqual(call.call_args.args[0], [w.CURL, '-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', w.HOST, 'http://127.0.0.1'+path])
        output = Output()
        with mock.patch.object(w, 'root_check'), mock.patch.object(w.subprocess, 'check_output', return_value=b'x') as call, mock.patch.object(w.sys, 'stdout', output), mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': w.CONTENT}):
            w.main()
        self.assertEqual(call.call_args.args[0], [w.CURL, '-s', '-H', w.HOST, 'http://127.0.0.1/RELEASE'])

    def test_templates_match_current_scripts(self):
        for name, variable, value in [('deploy', 'SHA', A), ('rollback', 'TARGET', B)]:
            source = (HERE.parent.parent/'tooling/deploy'/ (name+'.sh')).read_text().split('<<EOF\n',1)[1].split('\nEOF',1)[0]+'\n'
            source = source.replace('\\$', '$').replace('"$RELEASES"', '"/var/www/docs-releases"', 1).replace('"$'+variable+'"', '"'+value+'"',1).replace('KEEP="$KEEP"', 'KEEP="5"',1)
            template = (HERE/(name+'.template')).read_text().replace('{'+variable.lower()+'}',value)
            self.assertEqual(source, template)

if __name__ == '__main__': unittest.main()
