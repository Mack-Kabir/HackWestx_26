import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "services" / "kimodo" / "worker.py"
SPEC = importlib.util.spec_from_file_location("kimodo_worker", MODULE_PATH)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class WorkerCommandTests(unittest.TestCase):
    def test_builds_a_bounded_soma_rp_command(self):
        command = worker.build_command(4, "front-squat", Path("motion"))
        self.assertEqual(command[0], "kimodo_gen")
        self.assertIn("Kimodo-SOMA-RP-v1.1", command)
        self.assertIn("--bvh_standard_tpose", command)

    def test_rejects_unbounded_or_unknown_requests(self):
        for duration, variant in [(1, "front-squat"), (9, "front-squat"), (4, "deadlift"), (True, "bodyweight")]:
            with self.subTest(duration=duration, variant=variant):
                with self.assertRaises(ValueError):
                    worker.build_command(duration, variant, Path("motion"))


if __name__ == "__main__":
    unittest.main()
