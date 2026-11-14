// Creates a Cesium globe for one body (earth, mars, moon).
import * as Cesium from 'cesium';
import { cellToBoundary } from 'h3-js';
import { BODIES } from './bodies.js';
import { formatLatLon, latLonToCartesian, pickLatLon } from './coords.js';

const css = (c) => Cesium.Color.fromCssColorString(c);
const COLORS = {
  marker: css('#e2673a'),
  selected: css('#e2673a'),
  target: css('#f2c14e'), // target sites on the Moon / Mars
  analog: css('#4cc38a'), // known analogs on Earth
};
const LABEL_BG = css('rgba(16,20,31,0.85)');
const SITE_SIZE = 8;
const SELECTED_SIZE = 13;
// Points sit slightly above the surface so the globe never clips them, while still being
// depth-tested so sites on the far side of the planet stay hidden.
const SURFACE_OFFSET = 1000; // m

export function createGlobe(container, bodyKey) {
  const body = BODIES[bodyKey];
  const { ellipsoid } = body;

  const viewer = new Cesium.Viewer(container, {
    ellipsoid,
    baseLayer: new Cesium.ImageryLayer(body.base.make()),
    baseLayerPicker: false,
    geocoder: false,
    timeline: false,
    animation: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyAtmosphere: body.atmosphere ? undefined : false,
    // Cesium only adds stars by default with the Earth ellipsoid
    skyBox: Cesium.SkyBox.createEarthSkyBox(),
  });
  // Our own click handling replaces Cesium's default double-click "track entity"
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  const { scene } = viewer;
  const globe = scene.globe;
  globe.baseColor = css('#111');

  if (!body.atmosphere) {
    // No atmosphere, fog, or Earth's Sun/Moon on Mars and the Moon
    globe.showGroundAtmosphere = false;
    globe.enableLighting = false;
    scene.fog.enabled = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
  }

  // High-resolution layer, only drawn once the camera is close enough
  if (body.detail) {
    viewer.imageryLayers.add(
      new Cesium.ImageryLayer(body.detail.make(), { minimumTerrainLevel: body.detail.fromLevel }),
    );
  }

  // Relief layer (hidden by default)
  let reliefLayer = null;
  if (body.relief) {
    reliefLayer = viewer.imageryLayers.addImageryProvider(body.relief.make());
    reliefLayer.show = false;
  }

  const toCartesian = (lat, lon, height = 0) => latLonToCartesian(lat, lon, ellipsoid, body.latitudeType, height);

  // --- 2.4 Camera flights ---
  const home = Cesium.Cartesian3.fromDegrees(body.home.lon, body.home.lat, body.home.height, ellipsoid);
  viewer.camera.setView({ destination: home });
  viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
    e.cancel = true;
    viewer.camera.flyTo({ destination: home, duration: 1.5 });
  });

  /** Fly the camera straight above lat/lon (degrees) at `height` metres above the surface. */
  function flyTo(lat, lon, height = body.flyHeight, duration = 2) {
    return new Promise((resolve) => {
      viewer.camera.flyTo({ destination: toCartesian(lat, lon, height), duration, complete: resolve, cancel: resolve });
    });
  }

  // --- 2.1-2.3 Coordinates: click -> lat/lon, marker, live readout ---
  const toLatLon = (screenPosition) => pickLatLon(viewer, ellipsoid, body.latitudeType, screenPosition);

  const readout = document.createElement('div');
  readout.className = 'coords-readout';
  readout.textContent = '—';
  viewer.container.appendChild(readout);

  const labelStyle = (text) => ({
    text,
    font: '13px system-ui, sans-serif',
    fillColor: Cesium.Color.WHITE,
    showBackground: true,
    backgroundColor: LABEL_BG,
    backgroundPadding: new Cesium.Cartesian2(8, 5),
    pixelOffset: new Cesium.Cartesian2(0, -16),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
  });

  let marker = null;
  function setMarker(lat, lon, text = formatLatLon({ lat, lon })) {
    if (marker) viewer.entities.remove(marker);
    marker = viewer.entities.add({
      position: toCartesian(lat, lon, SURFACE_OFFSET),
      point: {
        pixelSize: 11,
        color: COLORS.marker,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: { ...labelStyle(text), pixelOffset: new Cesium.Cartesian2(0, -22) },
    });
  }
  function clearMarker() {
    if (marker) viewer.entities.remove(marker);
    marker = null;
  }

  // --- 2.5 / 2.6 Sites (target sites or known analogs) ---
  const sites = new Cesium.CustomDataSource('sites');
  viewer.dataSources.add(sites);
  let selected = null;

  /**
   * Draw a list of sites: [{ id?, name, lat, lon, subtitle? }].
   * kind = 'target' (Moon/Mars) or 'analog' (Earth); it only changes the colour.
   */
  function setSites(list, kind) {
    sites.entities.removeAll();
    selected = null;
    const color = COLORS[kind] ?? COLORS.target;
    for (const site of list) {
      sites.entities.add({
        id: `${kind}:${site.id ?? site.name}`,
        position: toCartesian(site.lat, site.lon, SURFACE_OFFSET),
        point: {
          pixelSize: SITE_SIZE,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
        },
        label: {
          ...labelStyle(site.name),
          font: '12px system-ui, sans-serif',
          // Smaller and fainter when far away, so the full globe is not cluttered
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1.5e7, 0.65),
          translucencyByDistance: new Cesium.NearFarScalar(5e6, 1.0, 2.5e7, 0.0),
        },
        properties: { site, kind, baseColor: color },
      });
    }
  }

  function styleSite(entity, isSelected) {
    const { baseColor } = entity.properties.getValue(viewer.clock.currentTime);
    entity.point.pixelSize = isSelected ? SELECTED_SIZE : SITE_SIZE;
    entity.point.color = isSelected ? COLORS.selected : baseColor;
    entity.point.outlineColor = isSelected ? Cesium.Color.WHITE : Cesium.Color.BLACK.withAlpha(0.6);
    entity.point.outlineWidth = isSelected ? 2 : 1;
    entity.label.translucencyByDistance = isSelected ? undefined : new Cesium.NearFarScalar(5e6, 1.0, 2.5e7, 0.0);
  }

  /** Highlight a site (by id or entity) and fly to it. */
  function selectSite(idOrEntity, { fly = true } = {}) {
    const entity = typeof idOrEntity === 'string' ? sites.entities.getById(idOrEntity) : idOrEntity;
    if (!entity) return null;
    if (selected && selected !== entity) styleSite(selected, false);
    selected = entity;
    styleSite(entity, true);
    clearMarker();
    const { site } = entity.properties.getValue(viewer.clock.currentTime);
    if (fly) flyTo(site.lat, site.lon);
    return site;
  }

  // --- 4.9 Outline of the H3 cell whose card is shown ---
  let cellOutline = null;
  function showCell(h3) {
    clearCell();
    const ring = cellToBoundary(h3).map(([lat, lon]) => toCartesian(lat, lon, SURFACE_OFFSET));
    cellOutline = viewer.entities.add({
      polyline: {
        positions: [...ring, ring[0]],
        width: 3,
        material: COLORS.selected,
        arcType: Cesium.ArcType.NONE,
      },
    });
  }
  function clearCell() {
    if (cellOutline) viewer.entities.remove(cellOutline);
    cellOutline = null;
  }

  // --- Hexagon layer: many H3 cells filled with a colour each (Earth matches) ---
  let hexPrimitive = null;
  const HEX_HEIGHT = 1500; // m above the ellipsoid: sits on the imagery without z-fighting

  /** Resolves once Cesium has built a primitive (geometry is made in web workers), or after `ms`. */
  function whenReady(primitive, ms = 4000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const off = scene.postRender.addEventListener(() => {
        if (primitive.ready || primitive.isDestroyed() || performance.now() - t0 > ms) {
          off();
          resolve();
        }
      });
    });
  }

  /**
   * list = [{ h3, color: CSS colour, alpha? }]; replaces any previous layer.
   * Returns a promise that resolves when the layer is ready to draw (fly the camera after that).
   */
  function showHexes(list) {
    clearHexes();
    if (!list.length) return Promise.resolve();
    const instances = list.map(({ h3, color, alpha = 0.78 }) => new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(cellToBoundary(h3).map(([la, lo]) => toCartesian(la, lo))),
        height: HEX_HEIGHT,
        ellipsoid,
        vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(css(color).withAlpha(alpha)) },
      id: `hex:${h3}`,
    }));
    hexPrimitive = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
    }));
    return whenReady(hexPrimitive);
  }
  function clearHexes() {
    if (hexPrimitive) scene.primitives.remove(hexPrimitive);
    hexPrimitive = null;
  }

  // --- Ranked results (#1, #2…) as labelled pins ---
  const ranks = new Cesium.CustomDataSource('ranks');
  viewer.dataSources.add(ranks);
  /** list = [{ lat, lon, text, color, payload }] */
  function setRanks(list) {
    ranks.entities.removeAll();
    list.forEach((r, k) => {
      ranks.entities.add({
        id: `rank:${k}`,
        position: toCartesian(r.lat, r.lon, SURFACE_OFFSET * 3),
        point: { pixelSize: k === 0 ? 14 : 11, color: css(r.color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          ...labelStyle(r.text),
          font: `${k === 0 ? 'bold 13px' : '12px'} system-ui, sans-serif`,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: 0,
        },
        properties: { payload: r.payload },
      });
    });
  }
  const clearRanks = () => ranks.entities.removeAll();

  // --- Search zone: a lat/lon box (zones.js) drawn as a faint fill + outline ---
  let zoneEntities = [];
  const ZONE_COLOR = css('#7fd1ff');

  /** Outline points of a box, every ≤1° so long edges follow parallels and meridians. */
  function boxRing(z) {
    const span = ((z.east - z.west) + 360) % 360 || 360;
    const full = span >= 359.9;
    const pts = [];
    const along = (la0, lo0, la1, lo1) => {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(la1 - la0), Math.abs(lo1 - lo0))));
      for (let k = 0; k <= steps; k++) pts.push(toCartesian(la0 + ((la1 - la0) * k) / steps, lo0 + ((lo1 - lo0) * k) / steps, 3000));
    };
    const e = z.west + span; // unwrapped east
    if (full) {
      // a full band of longitude: only the parallels (the pole side is a point)
      const rings = [];
      for (const la of [z.north, z.south]) {
        if (Math.abs(la) >= 89.9) continue;
        pts.length = 0;
        along(la, -180, la, 180);
        rings.push([...pts]);
      }
      return rings;
    }
    along(z.south, z.west, z.south, e);
    along(z.south, e, z.north, e);
    along(z.north, e, z.north, z.west);
    along(z.north, z.west, z.south, z.west);
    return [pts];
  }

  function showZone(z, { dashed = false } = {}) {
    clearZone();
    const rect = Cesium.Rectangle.fromDegrees(z.west, z.south, z.east, z.north);
    zoneEntities.push(viewer.entities.add({
      rectangle: { coordinates: rect, height: 800, material: ZONE_COLOR.withAlpha(0.07) },
    }));
    for (const ring of boxRing(z)) {
      zoneEntities.push(viewer.entities.add({
        polyline: {
          positions: ring,
          width: 2,
          arcType: Cesium.ArcType.NONE,
          material: dashed
            ? new Cesium.PolylineDashMaterialProperty({ color: ZONE_COLOR, dashLength: 12 })
            : ZONE_COLOR.withAlpha(0.9),
        },
      }));
    }
  }
  function clearZone() {
    zoneEntities.forEach((e) => viewer.entities.remove(e));
    zoneEntities = [];
  }
  function flyToZone(z, duration = 1.6) {
    if (((z.east - z.west) + 360) % 360 === 0) {
      // a whole band of longitude (Arctic, Antarctica): look straight down on the pole
      // (a band around the equator is shown from above its middle, at the body's scale)
      const R = ellipsoid.maximumRadius;
      const mPerDeg = (R * Math.PI) / 180;
      const pole = z.north >= 89.9 ? 90 : z.south <= -89.9 ? -90 : (z.north + z.south) / 2;
      const reach = pole === 90 || pole === -90 ? 90 - Math.min(Math.abs(z.south), Math.abs(z.north)) : (z.north - z.south) / 2;
      const height = Math.min(3 * R, Math.max(0.4 * R, reach * mPerDeg * 2.6));
      const lon = Math.abs(pole) === 90 ? 0 : Cesium.Math.toDegrees(viewer.camera.positionCartographic.longitude);
      viewer.camera.flyTo({ destination: toCartesian(pole, lon, height), duration });
      return;
    }
    const rect = Cesium.Rectangle.fromDegrees(z.west, z.south, z.east, z.north);
    viewer.camera.flyTo({ destination: rect, duration });
  }

  /**
   * Let the user drag a lat/lon box on the globe (camera frozen meanwhile).
   * Resolves { south, north, west, east } or null if cancelled (Esc / too small / off the globe).
   */
  let drawing = null;
  function drawBox() {
    if (drawing) return drawing.promise;
    const ctrl = scene.screenSpaceCameraController;
    const draw = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    let start = null;
    let box = null;
    let resolveFn;
    const promise = new Promise((r) => { resolveFn = r; });
    const boxOf = (a, b) => {
      // shortest way round in longitude: a drag never spans more than half the globe
      let west = Math.min(a.lon, b.lon);
      let east = Math.max(a.lon, b.lon);
      if (east - west > 180) [west, east] = [east, west];
      return { south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat), west, east };
    };
    const finish = (result) => {
      draw.destroy();
      document.removeEventListener('keydown', onKey, true);
      ctrl.enableInputs = true;
      viewer.canvas.style.cursor = '';
      drawing = null;
      suppressClick = true; // the mouse-up of the drag must not count as a click on Earth
      setTimeout(() => { suppressClick = false; }, 0);
      if (!result) clearZone();
      resolveFn(result);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(null);
    };
    document.addEventListener('keydown', onKey, true);
    ctrl.enableInputs = false;
    viewer.canvas.style.cursor = 'crosshair';
    draw.setInputAction((e) => {
      start = toLatLon(e.position);
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    draw.setInputAction((e) => {
      viewer.canvas.style.cursor = 'crosshair';
      if (!start) return;
      const p = toLatLon(e.endPosition);
      if (!p) return;
      box = boxOf(start, p);
      showZone(box, { dashed: true });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    draw.setInputAction((e) => {
      const p = start && toLatLon(e.position);
      if (p) box = boxOf(start, p);
      const ok = box && box.north - box.south > 0.2 && Math.abs(box.east - box.west) > 0.2;
      finish(ok ? box : null);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
    drawing = { promise, cancel: () => finish(null) };
    return promise;
  }

  /** Remove the coordinate marker, the cell outline and un-highlight the selected site. */
  function clearSelection() {
    clearMarker();
    clearCell();
    if (selected) styleSite(selected, false);
    selected = null;
  }

  // --- Mouse handling ---
  const pickListeners = [];
  const siteListeners = [];
  const rankListeners = [];

  let suppressClick = false; // true right after drawing a zone
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction((e) => {
    if (drawing || suppressClick) return;
    const picked = scene.pick(e.position);
    // only entities (sites, rank pins); the hexagon layer's ids are plain strings ("hex:…") and
    // EntityCollection.contains() throws on them, which used to swallow clicks on coloured cells
    const entity = picked?.id instanceof Cesium.Entity ? picked.id : null;
    if (entity && sites.entities.contains(entity)) {
      // with a listener, the app moves the camera itself once the site's data is ready
      const site = selectSite(entity, { fly: !siteListeners.length });
      siteListeners.forEach((fn) => fn(site));
      return;
    }
    if (entity && ranks.entities.contains(entity)) {
      const { payload } = entity.properties.getValue(viewer.clock.currentTime);
      rankListeners.forEach((fn) => fn(payload));
      return;
    }
    const p = toLatLon(e.position);
    if (!p) return;
    if (selected) styleSite(selected, false);
    selected = null;
    setMarker(p.lat, p.lon);
    pickListeners.forEach((fn) => fn(p));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Hover: the coordinates follow the mouse every frame, but the "is it clickable?" test is a GPU
  // pick (it redraws the scene, thousands of hexagons included), so it runs at most every 150 ms
  let lastHoverPick = 0;
  handler.setInputAction((e) => {
    const p = toLatLon(e.endPosition);
    readout.textContent = p ? formatLatLon(p) : '—';
    const now = performance.now();
    if (drawing || now - lastHoverPick < 150) return;
    lastHoverPick = now;
    const id = scene.pick(e.endPosition)?.id;
    const over = id instanceof Cesium.Entity ? id : null;
    const clickable = over && (sites.entities.contains(over) || ranks.entities.contains(over));
    viewer.canvas.style.cursor = clickable ? 'pointer' : '';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  return {
    viewer,
    body,
    hasRelief: !!reliefLayer,
    setRelief(on) {
      if (reliefLayer) reliefLayer.show = on;
    },
    flyTo,
    /** Put the marker at lat/lon (degrees, in this body's latitude convention). */
    setMarker,
    clearMarker,
    setSites,
    selectSite,
    clearSelection,
    /** Outline an H3 cell (id string) on the globe; clearCell() removes it. */
    showCell,
    clearCell,
    /** Fill many H3 cells with colours ([{ h3, color, alpha? }]); clearHexes() removes them. */
    showHexes,
    clearHexes,
    /** Numbered result pins ([{ lat, lon, text, color, payload }]); fn(payload) on click. */
    setRanks,
    clearRanks,
    /** Search zone box ({ south, north, west, east }): draw, fly to, let the user drag one. */
    showZone,
    clearZone,
    flyToZone,
    drawBox,
    cancelDraw() {
      drawing?.cancel();
    },
    onRankSelect(fn) {
      rankListeners.push(fn);
    },
    /** fn({ lat, lon }) when the user clicks empty ground. */
    onPick(fn) {
      pickListeners.push(fn);
    },
    /** fn(site) when the user clicks a site. */
    onSiteSelect(fn) {
      siteListeners.push(fn);
    },
    destroy() {
      handler.destroy();
      viewer.destroy();
    },
  };
}
