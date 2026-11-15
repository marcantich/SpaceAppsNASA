// Per-body configuration: ellipsoid, imagery layers and initial view.
// All layers are public and need no account (checked on 2026-11-14).
//
// Each body has up to three layers:
//   base   – global imagery, always on
//   detail – high-resolution imagery drawn on top once the camera is close enough
//   relief – shaded relief, toggled from the toolbar
import * as Cesium from 'cesium';

const TREK = 'https://trek.nasa.gov/tiles';
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

// Acknowledgement GIBS asks applications to show (earthdata.nasa.gov/gibs)
const GIBS_CREDIT = (product) =>
  `${product} · We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)`;

// Trek tiles: equirectangular, level 0 = 2×1 tiles of 256 px.
// maximumLevel = deepest level Trek actually serves (checked); beyond it Cesium upsamples.
const trekLayer = (body, layer, ellipsoid, maximumLevel, credit, ext = 'jpg') => ({
  make: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: `${TREK}/${body}/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`,
      tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid }),
      maximumLevel,
      credit,
    }),
});

// GIBS tiles in Web Mercator (EPSG:3857), 256 px, power-of-two pyramid
const gibsLayer = (layer, matrixLevel, credit) => ({
  make: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: `${GIBS}/${layer}/default/GoogleMapsCompatible_Level${matrixLevel}/{z}/{y}/{x}.jpeg`,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      maximumLevel: matrixLevel,
      credit,
    }),
});

// GIBS tiles in geographic lat/lon (EPSG:4326): unlike Web Mercator (which stops at ±85°) they reach
// the poles. GIBS pyramid: 512 px tiles, level 0 = 0.5625°/px, so one tile spans 288° and level 0
// is 2×1 tiles over a 576° × 288° grid anchored at (−180°, 90°); only the part over the globe is drawn.
const GIBS_GEO = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
const gibsGeoLayer = (layer, matrixSet, maximumLevel, credit) => ({
  make: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: `${GIBS_GEO}/${layer}/default/${matrixSet}/{z}/{y}/{x}.jpeg`,
      tilingScheme: new Cesium.GeographicTilingScheme({
        rectangle: Cesium.Rectangle.fromDegrees(-180, 90 - 288, -180 + 576, 90),
        numberOfLevelZeroTilesX: 2,
        numberOfLevelZeroTilesY: 1,
      }),
      rectangle: Cesium.Rectangle.MAX_VALUE,
      tileWidth: 512,
      tileHeight: 512,
      maximumLevel,
      credit,
    }),
});

export const BODIES = {
  earth: {
    name: 'Earth',
    ellipsoid: Cesium.Ellipsoid.WGS84,
    latitudeType: 'geodetic', // Earth datasets (MODIS, Copernicus…) use WGS84 geodetic latitude
    atmosphere: true,
    home: { lon: 0, lat: 20, height: 2.0e7 },
    flyHeight: 8.0e5, // default camera height (m) when flying to a site
    // geographic, not Web Mercator: covers the poles (Mercator stops at ±85° and left them blank)
    base: gibsGeoLayer('BlueMarble_ShadedRelief_Bathymetry', '500m', 7, GIBS_CREDIT('Blue Marble shaded relief and bathymetry, NASA Earth Observatory')),
    // Sentinel-2 cloudless 2016 (EOX, CC BY 4.0), ~10 m/px, Web Mercator
    detail: {
      fromLevel: 5,
      // Sentinel-2 cloudless 2016 does not cover Antarctica: EOX serves plain white tiles there
      // (even over the bare rock of the McMurdo Dry Valleys, checked 2026-11-15), which hid the
      // Blue Marble. South of 60° S the base layer is kept.
      rectangle: Cesium.Rectangle.fromDegrees(-180, -60, 180, 90),
      make: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          maximumLevel: 14,
          // attribution required by its CC BY 4.0 licence (wording asked by EOX)
          credit: new Cesium.Credit('<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless - https://s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 &amp; 2017) · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>'),
        }),
    },
    relief: gibsLayer('ASTER_GDEM_Color_Shaded_Relief', 12, GIBS_CREDIT('ASTER GDEM, NASA/METI/AIST/Japan Spacesystems')),
  },
  mars: {
    name: 'Mars',
    ellipsoid: Cesium.Ellipsoid.MARS,
    latitudeType: 'planetocentric', // PDS products (MOLA, TES, GRS) use planetocentric latitude
    atmosphere: false,
    home: { lon: 0, lat: 10, height: 1.1e7 },
    flyHeight: 6.0e5,
    base: trekLayer('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', Cesium.Ellipsoid.MARS, 7,
      'NASA Solar System Treks (Mars Trek) · Viking MDIM 2.1 colour mosaic, NASA/USGS'),
    // MRO CTX global mosaic, ~5 m/px, greyscale (listed by Mars Trek, served by Esri)
    detail: {
      fromLevel: 6,
      make: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
          tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: Cesium.Ellipsoid.MARS }),
          tileWidth: 512,
          tileHeight: 512,
          maximumLevel: 12,
          // credit line asked by the Murray Lab (free use of V01 for all purposes)
          credit: 'MRO CTX global mosaic V01 · Data credit: NASA/JPL/MSSS/The Murray Lab (Dickson et al. 2024, doi:10.1029/2024EA003555) · tiles served by Esri',
        }),
    },
    relief: trekLayer('Mars', 'Mars_MGS_MOLA_ClrShade_merge_global_463m', Cesium.Ellipsoid.MARS, 7,
      'NASA Solar System Treks (Mars Trek) · MGS MOLA colour shaded relief, NASA/JPL/GSFC'),
  },
  moon: {
    name: 'Moon',
    ellipsoid: Cesium.Ellipsoid.MOON,
    latitudeType: 'planetocentric',
    atmosphere: false,
    home: { lon: 0, lat: 0, height: 6.0e6 },
    flyHeight: 4.0e5,
    base: trekLayer('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', Cesium.Ellipsoid.MOON, 8,
      'NASA Solar System Treks (Moon Trek) · LRO WAC global mosaic, NASA/GSFC/Arizona State University'),
    detail: null,
    // LOLA colour hillshade v6 (Moon Trek serves it as PNG, not JPG)
    relief: trekLayer('Moon', 'LRO_LOLA_ClrShade_Global_256ppd_v06', Cesium.Ellipsoid.MOON, 8,
      'NASA Solar System Treks (Moon Trek) · LRO LOLA colour shaded relief, NASA/GSFC', 'png'),
  },
};
