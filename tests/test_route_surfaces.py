import importlib.util
import math
from pathlib import Path
import unittest
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
def module(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
s=module('build_route_surfaces');r=module('build_routes')
class SurfaceTests(unittest.TestCase):
 def test_triangle_interpolation_reproduces_real_mesh_vertex(self):
  import json
  d=json.loads((ROOT/'data/routes/curiosity.json').read_text())
  pts=d['render']['points']
  heights=s.sample([pts[0],pts[len(pts)//2],pts[-1]])
  np.testing.assert_allclose(heights,[pts[0][2],pts[len(pts)//2][2],pts[-1][2]],atol=.0001)
 def test_source_anchors_are_never_smoothed(self):
  source=[[77,18,1],[77.1,18.2,2],[77.3,18.1,3]]
  drawing,anchors=s.densify(source)
  self.assertEqual([drawing[i] for i in anchors],[p[:2] for p in source])
 def test_opportunity_archived_tm_origin_and_inverse(self):
  self.assertEqual(r.opportunity_lonlat(0,0),(-5.525785,-1.9487931))
  lon,lat=r.opportunity_lonlat(10464.54901,-22687.55553)
  lon0=math.radians(-5.525785);lat0=math.radians(-1.9487931)
  p,l=math.radians(lat),math.radians(lon)
  east=r.MARS_RADIUS*math.atanh(math.cos(p)*math.sin(l-lon0))
  north=r.MARS_RADIUS*(math.atan2(math.tan(p),math.cos(l-lon0))-lat0)
  self.assertAlmostEqual(east,10464.54901,places=6);self.assertAlmostEqual(north,-22687.55553,places=6)
if __name__=='__main__':unittest.main()
