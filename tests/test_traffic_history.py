import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from scripts.collect_traffic import SITE, append_snapshot, counter, fetch_totals, validate_history


class TrafficHistoryTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        self.history = {
            "version": 1,
            "site": SITE,
            "samples": [{"at": "2026-10-05T06:00:00Z", "views": 8, "visitors": 3}],
        }

    def test_fetch_only_reads_and_does_not_send_github_credentials(self):
        response = io.StringIO(json.dumps({"success": True, "data": {"site_pv": 8, "site_uv": 3}}))
        with patch("scripts.collect_traffic.urlopen", return_value=response) as request:
            self.assertEqual(fetch_totals(), {"views": 8, "visitors": 3})
        sent = request.call_args.args[0]
        self.assertEqual(sent.get_method(), "GET")
        self.assertEqual(sent.get_header("X-bsz-referer"), SITE)
        self.assertIsNone(sent.get_header("Authorization"))

    def test_service_errors_are_not_replaced_with_zero(self):
        with patch("scripts.collect_traffic.urlopen", return_value=io.StringIO('{"success":false}')):
            with self.assertRaises(ValueError):
                fetch_totals()
        for invalid in [-1, True, 1.2, "12", 2**53]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                counter(invalid)
        self.assertEqual(counter(0), 0)

    def test_records_observed_totals_without_inventing_intermediate_days(self):
        original = json.dumps(self.history)
        updated = append_snapshot(self.history, {"views": 14, "visitors": 4}, self.now + timedelta(days=2))
        self.assertEqual([sample["views"] for sample in updated["samples"]], [8, 14])
        self.assertEqual(json.dumps(self.history), original)

    def test_records_counter_reset_honestly(self):
        updated = append_snapshot(self.history, {"views": 1, "visitors": 1}, self.now)
        self.assertEqual([sample["views"] for sample in updated["samples"]], [8, 1])

    def test_preserves_newer_history_and_rejects_wrong_site(self):
        with self.assertRaises(ValueError):
            append_snapshot(self.history, {"views": 9, "visitors": 3}, self.now - timedelta(days=1))
        with self.assertRaises(ValueError):
            validate_history({**self.history, "site": "https://example.com/"})

    def test_retention_removes_only_expired_samples(self):
        old = {"at": "2026-09-01T12:00:00Z", "views": 1, "visitors": 1}
        updated = append_snapshot({**self.history, "samples": [old, *self.history["samples"]]}, {"views": 9, "visitors": 3}, self.now)
        self.assertEqual([sample["views"] for sample in updated["samples"]], [8, 9])


if __name__ == "__main__":
    unittest.main()
