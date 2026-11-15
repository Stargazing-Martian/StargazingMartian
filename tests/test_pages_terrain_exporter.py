import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('pages_terrain', Path(__file__).resolve().parents[1] / 'scripts/export_pages_terrain.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class StaticTerrainTests(unittest.TestCase):
    def test_tms_regions_and_ancestor_coverage(self):
        regions = [{'bounds': [-6.1, -2.1, -4.9, -1.4]}]
        plan = exporter.tile_plan(1, 9, regions)
        self.assertEqual(plan[0], {(0, 0), (1, 0)})
        self.assertIn((496, 250), plan[9])
        for z, tiles in enumerate(plan[1:], 1):
            for x, y in tiles:
                self.assertIn((x // 2, y // 2), plan[z - 1])

    def test_availability_advertises_only_existing_tiles(self):
        plan = [{(0, 0), (1, 0)}, {(0, 0), (2, 0), (3, 0), (0, 1)}]
        for expected, rectangles in zip(plan, exporter.availability(plan)):
            actual = {(x, y) for r in rectangles for y in range(r['startY'], r['endY'] + 1)
                      for x in range(r['startX'], r['endX'] + 1)}
            self.assertEqual(actual, expected)

    def mesh(self):
        header = struct.pack('<3d2f7d', 3396190, 0, 0, -100, 200, 0, 0, 0, 3396190, 1, 0, 0)
        return (header + struct.pack('<I', 3) + bytes(18) + struct.pack('<I3H', 1, 0, 0, 0) +
                bytes(16) + struct.pack('<BI', 1, 6) + bytes(6))

    def test_requires_complete_uncompressed_mesh_and_normals(self):
        mesh = self.mesh()
        self.assertEqual(exporter.validate_mesh(mesh), 3)
        for invalid in [b'<html>not a terrain tile</html>', mesh[:-2], mesh[:-11], b'\x1f\x8b' + mesh]:
            with self.assertRaises(ValueError):
                exporter.validate_mesh(invalid)

    def test_mission_plan_includes_full_route_bounds(self):
        root = Path(__file__).resolve().parents[1]
        regions = exporter.mission_regions(root, .5)
        self.assertEqual(len(regions), 11)
        self.assertEqual(len({r['id'] for r in regions}), 11)
        spirit = next(r for r in regions if r['id'] == 'spirit')
        self.assertLess(spirit['bounds'][0], 175.4726)
        self.assertGreater(spirit['bounds'][2], 175.4726)
