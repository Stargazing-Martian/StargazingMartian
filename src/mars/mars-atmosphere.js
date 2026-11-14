const Cesium = globalThis.Cesium;

function createAtmosphereLayer(viewer, radius, alpha) {

    const geometry = new Cesium.EllipsoidGeometry({
        radii: new Cesium.Cartesian3(
            radius,
            radius,
            radius
        ),
        vertexFormat: Cesium.VertexFormat.POSITION_ONLY
    });


    const material = new Cesium.Material({
        fabric: {
            type: "Color",
            uniforms: {
                color: new Cesium.Color(
                    1.0,
                    0.35,
                    0.15,
                    alpha
                )
            }
        }
    });


    const primitive = new Cesium.Primitive({

        geometryInstances: new Cesium.GeometryInstance({
            geometry
        }),

        appearance: new Cesium.MaterialAppearance({
            material,
            translucent: true,
            closed: false,
            faceForward: true
        }),

        asynchronous: false
    });


    viewer.scene.primitives.add(primitive);

    return primitive;
}


export function createMarsAtmosphere(viewer, ellipsoid) {

    const radius = ellipsoid.maximumRadius;


    const inner = createAtmosphereLayer(
        viewer,
        radius + 10000,
        0.15
    );


    const outer = createAtmosphereLayer(
        viewer,
        radius + 35000,
        0.05
    );


    return {
        inner,
        outer
    };
}