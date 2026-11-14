import attr
import numpy as np

from io import BytesIO
from struct import pack, unpack_from, pack_into
from quantized_mesh_encoder.extensions import ExtensionBase, ExtensionId
from quantized_mesh_encoder.constants import EXTENSION_HEADER
from quantized_mesh_encoder.normals import oct_encode
from quantized_mesh_encoder import encode
from quantized_mesh_encoder.constants import WGS84


def quantize(vertices: np.ndarray, triangles: np.ndarray, normals: np.ndarray, ellipsoid=WGS84) -> bytes:
    """Quantize vertices and triangles and add the vertex normals extension.

    Args:
        vertices (np.ndarray): tile vertices
        triangles (np.ndarray): triangle indices to the vertices
        normals (np.ndarray): vertex normals

    Returns:
        bytes: Quantized mesh tile
    """
    
    if normals is not None:
        vertex_normals = VertexNormalsExtension(normals=normals)

    with BytesIO() as f:
        if normals is None:
            encode(f, vertices, triangles, sphere_method="bounding_box", ellipsoid=ellipsoid)
        else:            
            encode(f, vertices, triangles, sphere_method="bounding_box", ellipsoid=ellipsoid, extensions=(vertex_normals, ))
            
        byte_data = bytearray(f.getvalue())
        # quantized-mesh-encoder 0.4.x returns this point in metres, but the
        # quantized-mesh header requires ellipsoid-scaled coordinates.
        horizon = unpack_from("<3d", byte_data, 64)
        pack_into("<3d", byte_data, 64,
                  horizon[0] / ellipsoid.a, horizon[1] / ellipsoid.a,
                  horizon[2] / ellipsoid.b)
        
    return bytes(byte_data)

@attr.s(kw_only=True)
class VertexNormalsExtension(ExtensionBase):
    """Vertex Normals Extension

    Kwargs:
        indices: mesh indices
        positions: mesh positions
        ellipsoid: instance of Ellipsoid class
    """

    id: ExtensionId = attr.ib(
        ExtensionId.VERTEX_NORMALS, validator=attr.validators.instance_of(ExtensionId)
    )
    normals: np.ndarray = attr.ib(validator=attr.validators.instance_of(np.ndarray))

    def encode(self) -> bytes:
        """Return encoded extension data"""
        
        encoded = oct_encode(self.normals).tobytes('C')
        buf = b''
        buf += pack(EXTENSION_HEADER['extensionId'], ExtensionId.VERTEX_NORMALS.value)
        buf += pack(EXTENSION_HEADER['extensionLength'], len(encoded))
        buf += encoded

        return buf