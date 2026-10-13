# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import core.profiles as profiles


class ProfileStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "profiles.json"
        self.override = patch.object(profiles, "PROFILES_FILE", self.path)
        self.override.start()
        self.addCleanup(self.override.stop)

    @unittest.skipUnless(sys.platform == "win32", "Windows 凭据加密验证")
    def test_secrets_are_encrypted_and_recoverable(self):
        manager = profiles.ProfileManager()
        created = manager.create(name="合成配置", cookie="synthetic-cookie-secret", extra_headers={"Authorization": "synthetic-header-secret"})
        stored = self.path.read_text(encoding="utf-8")
        self.assertNotIn("synthetic-cookie-secret", stored)
        self.assertNotIn("synthetic-header-secret", stored)
        recovered = profiles.ProfileManager().get(created.profile_id)
        self.assertEqual(recovered.cookie, "synthetic-cookie-secret")
        self.assertEqual(recovered.extra_headers, {"Authorization": "synthetic-header-secret"})

    @unittest.skipUnless(sys.platform == "win32", "Windows 凭据加密验证")
    def test_legacy_plaintext_configuration_migrates(self):
        legacy = profiles.BrowserProfile("synthetic", "合成旧配置", cookie="synthetic-legacy-cookie", user_agent="synthetic-agent").to_dict()
        self.path.write_text(json.dumps([legacy]), encoding="utf-8")
        loaded = profiles.ProfileManager().get("synthetic")
        self.assertEqual(loaded.cookie, "synthetic-legacy-cookie")
        self.assertEqual(loaded.user_agent, "synthetic-agent")
        self.assertNotIn("synthetic-legacy-cookie", self.path.read_text(encoding="utf-8"))

    def test_failed_save_does_not_add_profile_to_memory(self):
        manager = profiles.ProfileManager()
        with patch.object(os, "replace", side_effect=OSError("合成保存失败")):
            with self.assertRaises(OSError):
                manager.create(name="未保存的合成配置")
        self.assertFalse(any(item["name"] == "未保存的合成配置" for item in manager.list_all()))


if __name__ == "__main__":
    unittest.main()
