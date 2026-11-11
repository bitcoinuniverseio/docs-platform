import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('wrapper', HERE / 'wrapper.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class ProtocolTests(unittest.TestCase):
    def script(self, name, value):
        field = 'SHA' if name == 'deploy' else 'TARGET'
        return (HERE / (name + '.template')).read_text().replace('{RELEASES}', w.ROOT).replace('{' + field + '}', value).replace('{KEEP}', '5').encode()

    def test_exact_templates(self):
        for name, value in [('deploy', 'a' * 40), ('rollback', 'b' * 40), ('rollback', '')]:
            self.assertEqual(w.classify_script(self.script(name, value)), (name, value))

    def test_mutations_rejected(self):
        script = self.script('deploy', 'a' * 40)
        for data in (script + b'\n', script + b'\0', script.replace(b'KEEP="5"', b'KEEP="6"'), script.replace(b'a' * 40, b'$(id)' + b'a' * 35), b'x' * (w.LIMIT + 1)):
            self.assertIsNone(w.classify_script(data))

    def test_all_operations_deny(self):
        for command in ('bash -s', 'internal-sftp', 'scp -t /tmp/portal-' + 'a' * 40 + '.tgz', 'id', ''):
            result = subprocess.run([sys.executable, str(HERE / 'wrapper.py')], input=self.script('deploy', 'a' * 40), env=dict(os.environ, SSH_ORIGINAL_COMMAND=command), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b'')


if __name__ == '__main__':
    unittest.main()
