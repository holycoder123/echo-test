import json
from pathlib import Path
import tempfile
import unittest
from nycs_studio.case_library import CaseLibrary


class CaseLibraryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name) / "studio"
        self.library = CaseLibrary(self.root)

    def write_case(self, path, name="测试用例"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"schema_version": 1, "name": name, "selectors": [], "steps": []}), encoding="utf-8")
        return path

    def test_lists_nested_legacy_and_registered_external_cases_without_duplicates(self):
        first = self.write_case(self.root / "test_cases" / "邮件" / "extract.nycs.json", "提取邮件")
        self.write_case(self.root / "projects" / "demo" / "shop.json", "打开商城")
        external = self.write_case(Path(self.folder.name) / "external" / "saved.nycs.json")
        result = self.library.list([str(first), str(external), str(external), str(external.parent / "missing.json")])
        self.assertEqual(len(result["entries"]), 3)
        self.assertEqual(result["directory"], str(self.root / "test_cases"))
        entry = next(row for row in result["entries"] if row["name"] == "提取邮件")
        self.assertEqual(entry["location"], "test_cases/邮件/extract.nycs.json")
        self.assertEqual(entry["steps"], 0)
        self.assertTrue(entry["modified"])

    def test_does_not_include_evidence_raw_recordings_assets_or_unsaved_drafts(self):
        self.write_case(self.root / "test_cases" / "saved.nycs.json")
        for folder in ("test_cases/assets", "test_cases/.drafts", "recordings", "reports"):
            self.write_case(self.root / folder / "ignore.nycs.json")
        evidence = self.root / "projects" / "test_evidence.json"
        evidence.parent.mkdir(parents=True)
        evidence.write_text('{"events": [], "project": {}}', encoding="utf-8")
        self.assertEqual(len(self.library.list()["entries"]), 1)

    def test_invalid_named_case_is_visible_with_an_error_and_refresh_sees_changes(self):
        path = self.root / "test_cases" / "broken.nycs.json"
        path.write_text("{broken", encoding="utf-8")
        self.assertTrue(self.library.list()["entries"][0]["error"])
        self.write_case(path, "已修复")
        entry = self.library.list()["entries"][0]
        self.assertEqual(entry["name"], "已修复")
        self.assertEqual(entry["error"], "")
        path.unlink()
        self.assertEqual(self.library.list()["entries"], [])
