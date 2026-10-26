import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location('vendor_adb', Path(__file__).resolve().parents[1]/'scripts/vendor-adb.py')
vendor_adb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vendor_adb)


class VendorAdbTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as archive:
            for name in vendor_adb.FILES:
                archive.writestr('platform-tools/'+name, f'Pkg.Revision={vendor_adb.VERSION}' if name=='source.properties' else 'fixture '+name)
            archive.writestr('platform-tools/fastboot.exe','not needed')
            archive.writestr('../outside.txt','never extract')
        self.data=buffer.getvalue()
        self.hash=hashlib.sha256(self.data).hexdigest()
        self.pin=patch.object(vendor_adb,'SHA256',self.hash)
        self.pin.start();self.addCleanup(self.pin.stop)

    def test_archive_installs_only_adb_files_and_keeps_licenses_and_manifest(self):
        vendor_adb.install_archive(self.root,self.data)
        directory=vendor_adb.bundle_directory(self.root)
        self.assertEqual({p.name for p in directory.iterdir()},set(vendor_adb.FILES))
        self.assertFalse((self.root/'outside.txt').exists())
        self.assertTrue((directory/'NOTICE.txt').is_file())
        self.assertTrue(vendor_adb.verify_bundle(self.root,execute=False)['passed'])

    def test_checksum_mismatch_never_installs_downloaded_binaries(self):
        with self.assertRaisesRegex(ValueError,'checksum'):
            vendor_adb.install_archive(self.root,self.data+b'tampered')
        self.assertFalse(vendor_adb.bundle_directory(self.root).exists())

    def test_verification_rejects_missing_or_changed_dependency(self):
        vendor_adb.install_archive(self.root,self.data)
        dll=vendor_adb.bundle_directory(self.root)/'AdbWinApi.dll'
        dll.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'checksum'):
            vendor_adb.verify_bundle(self.root,execute=False)
        dll.unlink()
        with self.assertRaises(FileNotFoundError):
            vendor_adb.verify_bundle(self.root,execute=False)

    def test_cached_build_is_offline_and_adds_adb_to_existing_runtime_manifest(self):
        cache=self.root/'.runtime/android-build';cache.mkdir(parents=True)
        (cache/vendor_adb.ARCHIVE).write_bytes(self.data)
        runtime=self.root/'runtime';runtime.mkdir()
        (runtime/'manifest.json').write_text(json.dumps({'python':'fixture'}),encoding='utf-8')
        with patch.object(vendor_adb.urllib.request,'urlopen',side_effect=AssertionError('No network needed')), patch.object(vendor_adb,'verify_bundle',return_value={'passed':True}) as verify:
            self.assertTrue(vendor_adb.vendor(self.root)['passed'])
        verify.assert_called_once_with(self.root)
        manifest=json.loads((runtime/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['python'],'fixture')
        self.assertEqual(manifest['android_adb']['archive_sha256'],self.hash)

    def test_relocation_verifies_same_files_at_new_installation_location(self):
        import shutil
        vendor_adb.install_archive(self.root,self.data)
        moved=self.root/'moved installation'
        shutil.copytree(self.root/'runtime',moved/'runtime')
        result=vendor_adb.verify_bundle(moved,execute=False)
        self.assertTrue(result['passed'])
        self.assertEqual(Path(result['adb_path']),moved/'runtime/android/platform-tools/adb.exe')


if __name__=='__main__':
    unittest.main()
