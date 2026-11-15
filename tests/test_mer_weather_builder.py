import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mer_builder', Path(__file__).resolve().parents[1] / 'scripts/build_mer_weather.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MerBuilderTests(unittest.TestCase):
    def row(self, **changes):
        row = ['2P126543824ESF0100F0006L8M1', '-31.8', '1.480', '1.511', '1.003', '612.728', '0.923', '0.036']
        for index, value in changes.items():
            row[int(index)] = value
        return row

    def test_nasa_ceil_sol_and_integer_boundary(self):
        self.assertEqual(builder.parse_row(self.row(), '2')[1], 2)
        self.assertEqual(builder.parse_row(self.row(**{'3': '2.000'}), '2')[1], 2)
        self.assertEqual(builder.parse_row(self.row(**{'3': '2.001'}), '2')[1], 3)

    def test_missing_sentinel_excluded_but_real_zero_preserved(self):
        for index in ('5', '6', '7'):
            self.assertIsNone(builder.parse_row(self.row(**{index: '-1'}), '2'))
        self.assertEqual(builder.parse_row(self.row(**{'6': '0'}), '2')[4], 0)

    def test_rejects_cross_mission_and_nonfinite_data(self):
        with self.assertRaises(ValueError):
            builder.parse_row(self.row(), '1')
        with self.assertRaises(ValueError):
            builder.parse_row(self.row(**{'6': 'nan'}), '2')

    def test_clock_conversion_does_not_extrapolate(self):
        class Spice:
            def scs2e(self, spacecraft, clock):
                self.clock = clock
                return 101
            def et2utc(self, *args):
                raise AssertionError('Must not convert outside applicability')
        spice = Spice()
        self.assertIsNone(builder.convert_clock(spice, self.row()[0], -254, 0, 100))
        self.assertEqual(spice.clock, '1/126543824.000')
