import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('wrapper', HERE / 'wrapper.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
A, B, C = ('a' * 40, 'b' * 40, 'c' * 40)

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def archive(self, sha, extra=()):
        path = self.root / ('.upload-' + sha)
        with tarfile.open(path, 'w:gz') as t:
            for name, data, kind in [('index.html', b'ok', 'file'), ('RELEASE', (sha+'\n').encode(), 'file')] + list(extra):
                info = tarfile.TarInfo(name)
                if kind == 'file':
                    info.size = len(data); t.addfile(info, io.BytesIO(data))
                else:
                    info.type = {'sym':tarfile.SYMTYPE, 'hard':tarfile.LNKTYPE, 'device':tarfile.CHRTYPE}[kind]
                    info.linkname = '/etc/passwd'; t.addfile(info)
    def test_actual_scripts_match_templates(self):
        for name, value in [('deploy', A), ('rollback', ''), ('rollback', B)]:
            source = (HERE.parent.parent / 'tooling/deploy' / (name+'.sh')).read_text().split('<<EOF\n',1)[1].split('\nEOF',1)[0]+'\n'
            # Bash expands only these variables; escaped dollars are literal.
            source = source.replace('\\$', '\x01').replace('$RELEASES', str(self.root)).replace('$SHA', value).replace('$KEEP', '5').replace('$TARGET', value).replace('\x01', '$')
            self.assertEqual(w.script(self.root, source.encode()), (name, value))
            with self.assertRaises(w.Refused): w.script(self.root, (source+'id\n').encode())
    def test_deploy_rollback_and_retention(self):
        shas = [format(i, '040x') for i in range(1,8)]
        for sha in shas:
            self.archive(sha); w.deploy(self.root, sha)
        self.assertEqual(w.current(self.root), shas[-1])
        self.assertFalse((self.root / shas[0]).exists())
        with patch.object(w, 'curl') as curl:
            w.rollback(self.root, shas[-3]); w.rollback(self.root, '')
            self.assertEqual(w.current(self.root), shas[-1])
            self.assertEqual(curl.call_count, 4)
            self.assertEqual(curl.call_args_list[0].args[0][-1], w.URL + '/')
            self.assertEqual(curl.call_args_list[1].args[0][-1], w.URL + '/RELEASE')
    def test_archive_attacks(self):
        for name, kind in [('../escape','file'), ('/escape','file'), ('link','sym'), ('link','hard'), ('dev','device')]:
            self.archive(A, [(name, b'evil', kind)])
            with self.assertRaises(w.Refused): w.deploy(self.root, A)
            self.assertFalse((self.root / 'current').exists())
    def test_size_and_count_limits(self):
        self.archive(A, [('extra', b'abc', 'file')])
        with patch.object(w, 'MEMBERS', 2):
            with self.assertRaises(w.Refused): w.deploy(self.root, A)
        with patch.object(w, 'EXPANDED', 2):
            with self.assertRaises(w.Refused): w.deploy(self.root, A)
    def test_malicious_state(self):
        (self.root / 'current').symlink_to('/etc')
        with self.assertRaises(w.Refused): w.current(self.root)
        (self.root / 'current').unlink()
        (self.root / 'PREVIOUS').write_text('/etc\n')
        with self.assertRaises(w.Refused): w.rollback(self.root, '')
        (self.root / 'PREVIOUS').unlink()
        (self.root / 'PREVIOUS').symlink_to('/etc/passwd')
        with self.assertRaises(OSError): w.rollback(self.root, '')
    def test_scp(self):
        out = io.BytesIO(); w.receive(self.root, A, io.BytesIO(b'C0644 3 bundle.tgz\nabc\0'), out)
        self.assertEqual(out.getvalue(), b'\0\0\0')
        self.assertEqual((self.root / ('.upload-'+A)).read_bytes(), b'abc')
        for data in (b'D0755 0 x\n', b'C0644 999999999 x\n', b'C0644 3 x\nab', b'C0644 1 ../x\na\0'):
            with self.assertRaises(w.Refused): w.receive(self.root, A, io.BytesIO(data), io.BytesIO())
    def test_command_gate(self):
        for command in ('id', 'bash -c id', 'sftp', 'scp -t /etc/passwd',
                        'scp -t /tmp/portal-' + A + '.tgz;id', w.CONTENT + '\nwhoami'):
            with patch.object(w, 'ROOT', self.root), patch.object(w, 'check_root', return_value=self.root), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': command}):
                with self.assertRaises(w.Refused): w.main()
        for suffix in ('/', '/protocols/', '/pagefind/pagefind.js', '/RELEASE'):
            with patch.object(w, 'ROOT', self.root), patch.object(w, 'check_root', return_value=self.root), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': w.STATUS + suffix}), patch.object(w, 'curl') as curl:
                w.main()
                self.assertEqual(curl.call_args.args[0][-1], w.URL + suffix)
        with patch.object(w, 'ROOT', self.root), patch.object(w, 'check_root', return_value=self.root), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': w.CONTENT}), patch.object(w, 'curl') as curl:
            w.main()
            self.assertEqual(curl.call_args.args[0], ['-s', '-H', w.HOST, w.URL + '/RELEASE'])
    def test_untrusted_root(self):
        link = self.root / 'link'; link.symlink_to(self.root)
        with self.assertRaises(w.Refused): w.check_root(link)

if __name__ == '__main__': unittest.main()
