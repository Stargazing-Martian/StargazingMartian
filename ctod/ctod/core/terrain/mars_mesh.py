"""Dense Mars grids with a shared sampling halo for continuous vertex normals."""
import numpy as np
from quantized_mesh_encoder.ecef import to_ecef
from quantized_mesh_encoder.ellipsoid import Ellipsoid

from ctod.core.terrain.mars_raster import MARS_RADIUS

MARS = Ellipsoid(a=MARS_RADIUS, b=MARS_RADIUS)


def build_mesh(raster, z, x, y, cells=128, normals=True, flat=False):
    span = 180 / 2**z
    west, south = -180 + x * span, -90 + y * span
    delta = span / cells
    # Include one neighbour on each edge; read heights once for both mesh and normals.
    offset = 1 if normals else 0
    steps = np.arange(-offset, cells + 1 + offset) * delta
    lon, lat = np.meshgrid(west + steps, np.clip(south + steps, -90, 90))
    height = np.zeros_like(lon) if flat else raster.sample(lon, lat, z, cells)
    centre = (slice(1, -1), slice(1, -1)) if normals else (slice(None), slice(None))
    vertices = np.column_stack([lon[centre].ravel(), lat[centre].ravel(), height[centre].ravel()])
    indices = np.arange((cells + 1)**2).reshape(cells + 1, cells + 1)
    a, b, c, d = (indices[:-1, :-1].ravel(), indices[:-1, 1:].ravel(),
                  indices[1:, :-1].ravel(), indices[1:, 1:].ravel())
    triangles = np.vstack([np.column_stack([a, b, c]), np.column_stack([c, b, d])])
    vertex_normals = None
    if normals:
        positions = to_ecef(np.column_stack([lon.ravel(), lat.ravel(), height.ravel()]), ellipsoid=MARS)
        positions = positions.reshape(*lon.shape, 3)
        vertex_normals = np.cross(positions[1:-1, 2:] - positions[1:-1, :-2],
                                  positions[2:, 1:-1] - positions[:-2, 1:-1]).reshape(-1, 3)
        lengths = np.linalg.norm(vertex_normals, axis=1)
        radial = to_ecef(vertices, ellipsoid=MARS)
        radial /= np.linalg.norm(radial, axis=1)[:, None]
        valid = (lengths > 1e-9) & (np.abs(vertices[:, 1]) < 90)
        vertex_normals[valid] /= lengths[valid, None]
        vertex_normals[~valid] = radial[~valid]
    return vertices, triangles, vertex_normals
