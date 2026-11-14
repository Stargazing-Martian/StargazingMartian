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
