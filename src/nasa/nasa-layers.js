const Cesium = globalThis.Cesium;

export function createVikingImagery(ellipsoid) {
    return new Cesium.WebMapTileServiceImageryProvider({
        url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
        layer: "Mars_Viking_MDIM21_ClrMosaic_global_232m",
        style: "default",
        format: "image/jpeg",
        tileMatrixSetID: "default028mm",
        tileMatrixLabels: [
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7"
        ],
        tilingScheme: new Cesium.GeographicTilingScheme({
            ellipsoid: ellipsoid
        }),
        maximumLevel: 7
    });
}

// The bounds and matrix levels are from NASA Trek's WMTS capabilities,
// not a guessed global CTX endpoint. Transparent pixels retain Viking below.
export const CTX_REGIONS = [
    { id: 'Gale_CTX_BlockAdj_dd', bounds: [135.1842593, -6.5732988, 139.2413012, -2.8077809], max: 12 },
    { id: 'Gusev_CTX_BlockAdj_dd', bounds: [173.2463549, -16.2218451, 178.4633349, -10.9930557], max: 12 },
    { id: 'S_Meridiani_Sinus_Planium_CTX_BlockAdj_dd', bounds: [-8.093484, -4.8925742, -2.8037058, -.6078623], max: 12 },
    { id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', bounds: [77.1604655, 18.2110274, 77.6991776, 18.7211945], max: 13 },
];

export function createSurfaceImagery(viewer, ellipsoid) {
    const base = viewer.imageryLayers.addImageryProvider(createVikingImagery(ellipsoid));
    const details = CTX_REGIONS.map(region => {
        const provider = new Cesium.WebMapTileServiceImageryProvider({
            url: `https://trek.nasa.gov/tiles/Mars/EQ/${region.id}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
            layer: region.id, style: 'default', format: 'image/png',
            tileMatrixSetID: 'default028mm',
            tileMatrixLabels: Array.from({ length: region.max + 1 }, (_, level) => String(level)),
            maximumLevel: region.max,
            rectangle: Cesium.Rectangle.fromDegrees(...region.bounds),
            tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid }),
            credit: new Cesium.Credit(`<a href="https://trek.nasa.gov/tiles/Mars/EQ/${region.id}/1.0.0/WMTSCapabilities.xml">NASA MRO/CTX · ${region.id}</a>`),
        });
        provider.errorEvent.addEventListener(() => {
            document.getElementById('imagery-status').textContent =
                'Some NASA CTX images could not be loaded. Viking remains underneath; detail is incomplete.';
        });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.show = false;
        return layer;
    });
    let visible = true;
    function update() {
        // No close-up imagery downloads while in the whole-planet showcase.
        // Once visible, keep the full native matrix range, including on slow PCs.
        const close = viewer.camera.positionCartographic.height < 600_000;
        details.forEach(layer => { layer.show = visible && close; });
    }
    viewer.scene.preUpdate.addEventListener(update);
    return {
        get show() { return visible; },
        set show(value) { visible = value; base.show = value; update(); viewer.scene.requestRender(); },
    };
}
