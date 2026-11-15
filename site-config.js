// Shared deployment settings. Loaded before app.js on GitHub Pages and locally.
// The included static CTOD meshes work on Pages and locally without Docker.
// null opts into automatic local CTOD/Codespaces development connections.
// For an Azure-hosted CTOD, set the complete HTTPS URL ending in /tiles/mars.
// Do not put credentials or keys in this public file.
globalThis.STARGAZING_CONFIG = {
    terrainUrl: './data/terrain/mars',
    terrainTimeoutMs: 120000,
    ...globalThis.STARGAZING_CONFIG,
};
