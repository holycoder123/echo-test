import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('vendor_scrcpy',Path(__file__).resolve().parents[1]/'scripts/vendor-scrcpy.py')
vendor=importlib.util.module_from_spec(spec);spec.loader.exec_module(vendor)


class VendorScrcpyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        content=io.BytesIO()
        with zipfile.ZipFile(content,'w') as archive:archive.writestr('classes.dex',b'fixture')
        self.data={'scrcpy-server.jar':content.getvalue(),'LICENSE':b'Apache-2.0 fixture'}
        assets={name:(name,'https://example.invalid/'+name,hashlib.sha256(data).hexdigest()) for name,data in self.data.items()}
        patched=patch.object(vendor,'ASSETS',assets);patched.start();self.addCleanup(patched.stop)
        self.cache=self.root/'.runtime/scrcpy-build';self.cache.mkdir(parents=True)
        for name,data in self.data.items():(self.cache/name).write_bytes(data)

    def test_cached_server_and_license_are_bundled_and_verified_without_network(self):
        with patch.object(vendor.urllib.request,'urlopen',side_effect=AssertionError('No network')):
            self.assertTrue(vendor.vendor(self.root)['passed'])
        manifest=json.loads((self.root/'runtime/android/scrcpy/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['version'],'3.3.4')
        self.assertTrue((self.root/'runtime/android/scrcpy/LICENSE').is_file())

    def test_corrupted_download_cannot_replace_bundled_server(self):
        (self.cache/'scrcpy-server.jar').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'checksum'):vendor.vendor(self.root)
        self.assertFalse((self.root/'runtime/android/scrcpy/scrcpy-server.jar').exists())

    def test_missing_or_changed_license_fails_offline_verification(self):
        vendor.vendor(self.root)
        (self.root/'runtime/android/scrcpy/LICENSE').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'checksum'):vendor.verify(self.root)


if __name__=='__main__':unittest.main()
