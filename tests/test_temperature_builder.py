import importlib.util
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('temperature_builder', Path(__file__).resolve().parents[1] / 'scripts/build_temperature_maps.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
START, END = '2004-01-22T13:41:18Z', '2004-01-29T17:10:44Z'


def retrieval(temperature=273.15, lon=0, lat=0, ltst=14, utc='2004-01-23T14:00:00Z'):
    return ['1', '1', utc, str(lon), str(lat), '340', str(ltst), '0.2', '0.02', '0', str(temperature), '10', '610']


class TemperatureBuilderTests(unittest.TestCase):
    def test_kelvin_mean_range_and_sample_spread(self):
        fields, selected, rejected = builder.aggregate([retrieval(273.15), retrieval(283.15)], START, END)
        i = fields['COUNT'].index(2)
        self.assertEqual((selected, rejected), (2, 0))
        self.assertEqual(fields['MEAN_K'][i], 278.15)
        self.assertEqual(fields['MIN_K'][i], 273.15)
        self.assertEqual(fields['MAX_K'][i], 283.15)
        self.assertEqual(fields['STD_K'][i], round(math.sqrt(50), 2))

    def test_daytime_and_utc_filters_do_not_mix_other_periods(self):
        rows = [retrieval(ltst=13), retrieval(ltst=14.9999), retrieval(ltst=15), retrieval(ltst=2),
                retrieval(utc='2004-02-01T14:00:00Z')]
        fields, selected, rejected = builder.aggregate(rows, START, END)
        self.assertEqual((selected, rejected), (2, 2))
        self.assertEqual(sum(v or 0 for v in fields['COUNT']), 2)

    def test_single_sample_and_empty_bins_have_no_invented_spread(self):
        fields, _, _ = builder.aggregate([retrieval()], START, END)
        self.assertEqual(fields['COUNT'].count(1), 1)
        self.assertEqual(fields['MEAN_K'].count(None), 3599)
        self.assertTrue(all(v is None for v in fields['STD_K']))

    def test_zero_and_360_longitudes_share_a_bin_and_dateline_wraps(self):
        fields, _, _ = builder.aggregate([retrieval(lon=0), retrieval(lon=360),
            retrieval(lon=179), retrieval(lon=181)], START, END)
        self.assertEqual(fields['COUNT'].count(2), 2)

    def test_physical_missing_values_are_excluded(self):
        fields, selected, rejected = builder.aggregate([retrieval(temperature=-999.99),
            retrieval(temperature=float('nan')), retrieval(lat=91)], START, END)
        self.assertEqual((selected, rejected), (0, 3))
        self.assertTrue(all(v is None for v in fields['MEAN_K']))

    def test_invalid_record_layout_fails(self):
        with self.assertRaises(ValueError):
            builder.aggregate([['bad']], START, END)


if __name__ == '__main__':
    unittest.main()
