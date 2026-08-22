import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Delaunay } from 'd3-delaunay';
import { updateCharts } from './chart.js';

const visualisationRuntime = {
  scene: null,
  renderer: null,
  camera: null,
  controls: null,
  container: null,
  animationFrameId: null,
  rayHandlers: null,
  userLocationUpdater: null
}

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (typeof material.dispose === 'function') {
    material.dispose();
  }
}

function disposeObjectDeep(obj) {
  if (!obj) return;
  if (obj.children && obj.children.length > 0) {
    obj.children.slice().forEach(child => {
      disposeObjectDeep(child);
      obj.remove(child);
    });
  }
  if (obj.geometry && typeof obj.geometry.dispose === 'function') {
    obj.geometry.dispose();
  }
  disposeMaterial(obj.material);
}

function teardownVisualisationRuntime() {
  if (visualisationRuntime.animationFrameId !== null) {
    cancelAnimationFrame(visualisationRuntime.animationFrameId);
    visualisationRuntime.animationFrameId = null;
  }

  const container = visualisationRuntime.container;
  const handlers = visualisationRuntime.rayHandlers;
  if (container && handlers) {
    container.removeEventListener('pointerdown', handlers.down);
    container.removeEventListener('pointermove', handlers.move);
    container.removeEventListener('pointerup', handlers.up);
    container.removeEventListener('pointercancel', handlers.up);
    if (container._rummz_ray_handlers === handlers) {
      delete container._rummz_ray_handlers;
    }
  }
  visualisationRuntime.rayHandlers = null;

  if (visualisationRuntime.controls && typeof visualisationRuntime.controls.dispose === 'function') {
    visualisationRuntime.controls.dispose();
  }
  visualisationRuntime.controls = null;

  if (visualisationRuntime.scene) {
    disposeObjectDeep(visualisationRuntime.scene);
  }
  visualisationRuntime.scene = null;

  if (visualisationRuntime.renderer) {
    if (visualisationRuntime.renderer.domElement && visualisationRuntime.renderer.domElement.parentNode) {
      visualisationRuntime.renderer.domElement.parentNode.removeChild(visualisationRuntime.renderer.domElement);
    }
    visualisationRuntime.renderer.dispose();
    if (typeof visualisationRuntime.renderer.forceContextLoss === 'function') {
      visualisationRuntime.renderer.forceContextLoss();
    }
  }
  visualisationRuntime.renderer = null;
  visualisationRuntime.camera = null;
  visualisationRuntime.container = null;
  visualisationRuntime.userLocationUpdater = null;
  window.userLocationGroup = null;
  window.scene = null;
}

function setBoreholeMarkersVisible(visible) {
  if (window.boreholeMarkerGroup) {
    window.boreholeMarkerGroup.visible = visible;
  }
  window.boreholeMarkersVisible = visible;
}

window.setBoreholeMarkersVisible = setBoreholeMarkersVisible;

function setBoreholeCylindersVisible(visible) {
  if (window.boreholeCylinderGroup) {
    window.boreholeCylinderGroup.visible = visible;
  }
  window.boreholeCylindersVisible = visible;
}

function setSpreadVolumesVisible(visible) {
  if (window.spreadVolumeGroup) {
    window.spreadVolumeGroup.visible = visible;
  }
  window.spreadVolumesVisible = visible;
}

window.setBoreholeCylindersVisible = setBoreholeCylindersVisible;
window.setSpreadVolumesVisible = setSpreadVolumesVisible;

function setTopographyVisible(visible) {
  if (window.topographyGroup) {
    window.topographyGroup.visible = visible;
  }
  window.topographyVisible = visible;
}

function setUserLocationVisible(visible) {
  if (window.userLocationGroup) {
    window.userLocationGroup.visible = visible;
  }
  window.userLocationVisible = visible;
}

function setUserLocationData(locationData) {
  if (!locationData || typeof locationData.lat !== 'number' || typeof locationData.lng !== 'number') {
    return;
  }

  window.userLocationData = {
    lat: locationData.lat,
    lng: locationData.lng,
    accuracy: Number.isFinite(locationData.accuracy) ? locationData.accuracy : null,
    timestamp: locationData.timestamp || Date.now()
  };

  if (typeof visualisationRuntime.userLocationUpdater === 'function') {
    visualisationRuntime.userLocationUpdater();
  }
}

window.setTopographyVisible = setTopographyVisible;
window.setUserLocationVisible = setUserLocationVisible;

if (!window.__rummzBoreholeVisibilityListenersBound) {
  window.addEventListener('toggleBoreholeCylinders', function(event) {
    setBoreholeCylindersVisible(!!event.detail?.visible);
  });
  window.addEventListener('toggleSpreadVolumes', function(event) {
    setSpreadVolumesVisible(!!event.detail?.visible);
  });
  window.__rummzBoreholeVisibilityListenersBound = true;
}

if (!window.__rummzToggleTopographyListenerBound) {
  window.addEventListener('toggleTopography', function(event) {
    setTopographyVisible(!!event.detail?.visible);
  });
  window.__rummzToggleTopographyListenerBound = true;
}

if (!window.__rummzDgmModeSwitchListenerBound) {
  window.addEventListener('switchVisualisationMode', function(event) {
    if (event.detail?.previousMode === 'dgm') {
      teardownVisualisationRuntime();
    }
  });
  window.__rummzDgmModeSwitchListenerBound = true;
}

if (!window.__rummzToggleBoreholeMarkersListenerBound) {
  window.addEventListener('toggleBoreholeMarkers', function(event) {
    setBoreholeMarkersVisible(!!event.detail?.visible);
  });
  window.__rummzToggleBoreholeMarkersListenerBound = true;
}

if (!window.__rummzToggleUserLocationListenerBound) {
  window.addEventListener('toggleUserLocation', function(event) {
    setUserLocationVisible(!!event.detail?.visible);
  });
  window.__rummzToggleUserLocationListenerBound = true;
}

if (!window.__rummzUpdateUserLocationListenerBound) {
  window.addEventListener('updateUserLocation', function(event) {
    setUserLocationData(event.detail);
  });
  window.__rummzUpdateUserLocationListenerBound = true;
}

/**
 * IFC snapshot contract shared with script.js.
 * @typedef {Object} RummzIfcSnapshot
 * @property {Array} cardsData
 * @property {Array} ifcMeshes
 * @property {{x:number,y:number,z:number}} ifcOrigin
 * @property {number} updatedAt
 */

/**
 * Builds the current IFC export snapshot payload.
 * @param {Array} cardsData
 * @param {Array} ifcMeshes
 * @param {{x:number,y:number,z:number}} ifcOrigin
 * @returns {RummzIfcSnapshot}
 */
function buildRummzIfcSnapshot(cardsData, ifcMeshes, ifcOrigin) {
  return {
    cardsData,
    ifcMeshes: Array.isArray(ifcMeshes) ? ifcMeshes : [],
    ifcOrigin: ifcOrigin || { x: 0, y: 0, z: 0 },
    updatedAt: Date.now()
  };
}

function publishRummzIfcSnapshot(cardsData, ifcMeshes, ifcOrigin) {
  window.rummzIfcSnapshot = buildRummzIfcSnapshot(cardsData, ifcMeshes, ifcOrigin);
}

/**
 * Contract reader for external consumers (e.g. script.js IFC export).
 * @returns {RummzIfcSnapshot|null}
 */
window.getRummzIfcSnapshot = function() {
  return window.rummzIfcSnapshot || null;
};

function lonToTileX(lon, zoom) {
  return Math.floor((lon + 180) / 360 * (1 << zoom));
}
function latToTileY(lat, zoom) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << zoom));
}
function tileToLon(x, zoom) {
  return x / (1 << zoom) * 360 - 180;
}
function tileToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / (1 << zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Stitches OSM raster tiles covering the grid's bounding box and drapes them as a plane over the grid, toggled by the "Topografie" icon.
async function buildTopographyOverlay(scene, gridSize, centerX, centerZ, midNHN, refLat, refLon, metersPerDegLat, metersPerDegLon) {
  const topographyGroup = new THREE.Group();
  topographyGroup.name = 'topography-overlay';
  topographyGroup.visible = window.topographyVisible === true;
  window.topographyGroup = topographyGroup;
  scene.add(topographyGroup);

  try {
    const halfLatSpan = (gridSize / 2) / metersPerDegLat;
    const halfLonSpan = (gridSize / 2) / metersPerDegLon;
    const north = refLat + halfLatSpan;
    const south = refLat - halfLatSpan;
    const west = refLon - halfLonSpan;
    const east = refLon + halfLonSpan;

    const targetPixels = 1024;
    const metersPerPixel = gridSize / targetPixels;
    const rawZoom = Math.log2((156543.03392 * Math.cos(refLat * Math.PI / 180)) / metersPerPixel);
    const zoom = Math.min(18, Math.max(3, Math.round(rawZoom)));

    const tileMinX = lonToTileX(west, zoom);
    const tileMaxX = lonToTileX(east, zoom);
    const tileMinY = latToTileY(north, zoom);
    const tileMaxY = latToTileY(south, zoom);

    const tilesWide = tileMaxX - tileMinX + 1;
    const tilesHigh = tileMaxY - tileMinY + 1;
    if (tilesWide <= 0 || tilesHigh <= 0 || tilesWide * tilesHigh > 64) return; // sanity guard against oversized fetches

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tilesWide * 256;
    tileCanvas.height = tilesHigh * 256;
    const tileCtx = tileCanvas.getContext('2d');

    const loadTile = (tx, ty) => new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
    });

    const tilePromises = [];
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      for (let tx = tileMinX; tx <= tileMaxX; tx++) {
        tilePromises.push(loadTile(tx, ty).then(img => {
          if (img) {
            tileCtx.drawImage(img, (tx - tileMinX) * 256, (ty - tileMinY) * 256);
          }
        }));
      }
    }
    await Promise.all(tilePromises);

    // Crop the stitched tile mosaic down to the exact lat/lon bbox of the grid
    const mosaicWest = tileToLon(tileMinX, zoom);
    const mosaicEast = tileToLon(tileMaxX + 1, zoom);
    const mosaicNorth = tileToLat(tileMinY, zoom);
    const mosaicSouth = tileToLat(tileMaxY + 1, zoom);

    const cropX = ((west - mosaicWest) / (mosaicEast - mosaicWest)) * tileCanvas.width;
    const cropY = ((mosaicNorth - north) / (mosaicNorth - mosaicSouth)) * tileCanvas.height;
    const cropW = ((east - west) / (mosaicEast - mosaicWest)) * tileCanvas.width;
    const cropH = ((north - south) / (mosaicNorth - mosaicSouth)) * tileCanvas.height;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(1, Math.round(cropW));
    cropCanvas.height = Math.max(1, Math.round(cropH));
    cropCanvas.getContext('2d').drawImage(
      tileCanvas,
      cropX, cropY, cropW, cropH,
      0, 0, cropCanvas.width, cropCanvas.height
    );

    const texture = new THREE.CanvasTexture(cropCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(gridSize, gridSize);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centerX, midNHN + 0.001, centerZ); // small offset so it sits on top of the grid without z-fighting
    mesh.renderOrder = -1;
    topographyGroup.add(mesh);
  } catch (err) {
    console.warn('Topografie-Overlay konnte nicht geladen werden:', err);
  }
}

function updateVisualisation (cardsData) {
  teardownVisualisationRuntime();

  if (!Array.isArray(cardsData) || cardsData.length === 0) {
    publishRummzIfcSnapshot([], [], { x: 0, y: 0, z: 0 });
    updateCharts([], {});
    return;
  }

  // VALIDATE ONLY THE DATA FOR VISUALIZATION

  function isRenderableLayer(layer) {
    return !!layer
      && typeof layer.name === 'string'
      && layer.name.trim() !== ''
      && typeof layer.height === 'number'
      && layer.height > 0
      && typeof layer.color === 'string';
  }

  function validateBorehole(borehole) {
    // CONTROL MAIN DATA
    if (
      !borehole ||
      typeof borehole.coords !== "object" ||
      borehole.coords === null ||
      typeof borehole.nhn !== "number" ||
      !Array.isArray(borehole.layers)
    ) {
      return false;
    }
    // CONTROL COORDS
    if (
      typeof borehole.coords.lat !== "number" ||
      typeof borehole.coords.lng !== "number"
    ) {
      return false;
    }
    return borehole.layers.some(isRenderableLayer);
  }

  const renderCardsData = cardsData
    .map(borehole => {
      if (!borehole || !Array.isArray(borehole.layers)) {
        return null;
      }

      const renderableLayers = borehole.layers.filter(isRenderableLayer);
      if (renderableLayers.length === 0) {
        return null;
      }

      return {
        ...borehole,
        layers: renderableLayers
      };
    })
    .filter(validateBorehole);

  if (renderCardsData.length === 0) {
    publishRummzIfcSnapshot([], [], { x: 0, y: 0, z: 0 });
    updateCharts([], {});
    return;
  }

  const container = document.getElementById('dashboard-map');
  if (!container) return;

  // INITIALIZE THREE.JS
  const scene = new THREE.Scene();
  scene.background = null;
  window.scene = scene; // GLOBAL FOR EXPORT

  const existingCanvas = container.querySelector('canvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }

  container.style.position = container.style.position || 'relative';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.zIndex = '0';
  container.appendChild(renderer.domElement);

  // CAMERA
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth/container.clientHeight, 0.1, 1000);
  scene.add(camera);

  // ORBIT-CONTROLS
  const controls = new OrbitControls(camera, renderer.domElement);

  visualisationRuntime.scene = scene;
  visualisationRuntime.renderer = renderer;
  visualisationRuntime.camera = camera;
  visualisationRuntime.controls = controls;
  visualisationRuntime.container = container;

  // Lights
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff,0.4));
    
  // GEO-CENTER DER BOHRUNGEN ALS LAT/LON
  const refLat = renderCardsData.reduce((s,b)=>s+b.coords.lat,0)/renderCardsData.length;
  const refLon = renderCardsData.reduce((s,b)=>s+b.coords.lng,0)/renderCardsData.length;

  // TRANSFORM LAT/LON TO METER (EQUI APPROX)
  // 1° Lat = ca. 111320 m
  const metersPerDegLat = 111320;

  // CALC GRAD IN RADIANT
  // 1° Lon = ca. 111320 * cos(Lat) m
  const metersPerDegLon = 111320 * Math.cos(refLat * Math.PI/180);

  // CALC LAT/LON IN X/Z (METER)
  function latLonToXZ(lat, lon) {
    const x = (lon - refLon) * metersPerDegLon;
    const z = (refLat - lat) * metersPerDegLat; 
    return { x, z };
  }

  // GROUND GRID
  // CENTERING GRID
  const highestNHN = Math.max(...renderCardsData.map(bh => bh.nhn));
  const lowestLayerEndpoint = Math.min(...renderCardsData.map(bh => {
    const depth = bh.layers.reduce((sum, layer) => sum + layer.height / 100, 0);
    return bh.nhn - depth;
  }));
  const midNHN = (highestNHN + lowestLayerEndpoint) / 2;

  // CALC X/Z-POS OF DRILL CORES
  const positions = renderCardsData.map(bh => latLonToXZ(bh.coords.lat, bh.coords.lng));

  // CACL MIN/MAX FOR X AND Z (Y IS UP)
  const xs = positions.map(p => p.x);
  const zs = positions.map(p => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const { x: centerX, z: centerZ } = latLonToXZ(refLat, refLon);

  // CALC GRID-SIZE PLUS PUFFER
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  const minGridSize = 20; // 20 METERS
  const gridSize = Math.max(minGridSize, Math.max(extentX, extentZ) * 1.5);
  console.log("Grid size:", gridSize);

  // CALC GRID-DIVISION
  const divisions = 5//Math.max(5, Math.round(gridSize / 20));
  //if (divisions % 2 === 0) divisions += 1; // sicherstellen, dass divisions ungerade ist
  //console.log("Divisions:", divisions);

  // GIVE CALCS TO DASHBOARD
  const gridSizeM_Element = document.getElementById('grid-size-m');
  const gridSizeM2_Element = document.getElementById('grid-size-m2');
  const divisionM_Element = document.getElementById('division-m');
  const divisionM2_Element = document.getElementById('division-m2');

  if (gridSizeM_Element) {
    const label = gridSizeM_Element.labels[0]; // Get the associated label
    // Switch between meters and kilometers based on grid size
    if (gridSize < 1000) {
      if (label) {
        label.textContent = `Grid-Size in m`;
      }
      gridSizeM_Element.value = `${gridSize.toFixed(2)} x ${gridSize.toFixed(2)}`;
      } else {
        const gridSizeKm = gridSize / 1000;
      if (label) {
        label.textContent = `Grid-Size in km`;
      }
      gridSizeM_Element.value = `${gridSizeKm.toFixed(2)} x ${gridSizeKm.toFixed(2)}`;
    }
  }

  if (gridSizeM2_Element) {
    const label = gridSizeM2_Element.labels[0]; // Get the associated label
    // Switch between meters and kilometers based on grid size
    if (gridSize < 1000) {
      if (label) {
        label.textContent = `Grid-Size in m²`;
      }
      gridSizeM2_Element.value = `${(gridSize * gridSize).toFixed(2)}`;
      } else {
        const gridSizeKm = gridSize / 1000;
          if (label) {
            label.textContent = `Grid-Size in km²`;
          }
      gridSizeM2_Element.value = (gridSizeKm * gridSizeKm).toFixed(2);
    }
  }

  if (divisionM_Element) {
    const label = divisionM_Element.labels[0]; // Get the associated label
    // Switch between meters and kilometers based on grid size
    if (gridSize / divisions < 1000) {
      if (label) {
        label.textContent = `Division in m`;
      }
    divisionM_Element.value = `${(gridSize / divisions).toFixed(2)} x ${(gridSize / divisions).toFixed(2)}`;
    } else {
      const gridSizeKm = gridSize / 1000;
      if (label) {
        label.textContent = `Division in km`;
      }
      divisionM_Element.value = `${(gridSizeKm / divisions).toFixed(2)} x ${(gridSizeKm / divisions).toFixed(2)}`;
    }
  }

  if (divisionM2_Element) {
    const label = divisionM2_Element.labels[0]; // Get the associated label
    // Switch between meters and kilometers based on grid size
    if (gridSize / divisions < 1000) {
        if (label) {
            label.textContent = `Division in m²`;
        }
        divisionM2_Element.value = ((gridSize / divisions) * (gridSize / divisions)).toFixed(2);
      } else {
        const gridSizeKm = gridSize / 1000;
        if (label) {
            label.textContent = `Division in km²`;
        }
        divisionM2_Element.value = ((gridSizeKm / divisions) * (gridSizeKm / divisions)).toFixed(2);
      }
  };

  // BOREHOLE MARKERS (hidden by default, toggled by the geo-alt icon)
  const boreholeMarkerGroup = new THREE.Group();
  boreholeMarkerGroup.name = 'borehole-markers';
  boreholeMarkerGroup.visible = window.boreholeMarkersVisible === true;
  window.boreholeMarkerGroup = boreholeMarkerGroup;

  renderCardsData.forEach((bh, bhIndex) => {
    const { x, z } = latLonToXZ(bh.coords.lat, bh.coords.lng);
    const markerRoot = new THREE.Group();
    markerRoot.position.set(x, bh.nhn, z);
    markerRoot.userData = { boreholeIndex: bhIndex, boreholeId: bh.id, isMarker: true };

    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(24, 24, 18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(73, 80, 87, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bhIndex + 1), 24, 24);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const labelMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false
    });
    const label = new THREE.Sprite(labelMaterial);
    label.position.y = 0.06;
    label.scale.set(0.09, 0.09, 1);
    label.renderOrder = 9999;
    markerRoot.add(label);

    boreholeMarkerGroup.add(markerRoot);
  });

  scene.add(boreholeMarkerGroup);

  // USER LOCATION MARKER (hidden by default, toggled by the crosshair icon)
  const userLocationGroup = new THREE.Group();
  userLocationGroup.name = 'user-location';
  userLocationGroup.visible = window.userLocationVisible === true;
  window.userLocationGroup = userLocationGroup;
  scene.add(userLocationGroup);

  function clearUserLocationGroup() {
    userLocationGroup.children.slice().forEach(child => {
      disposeObjectDeep(child);
      userLocationGroup.remove(child);
    });
  }

  function getNearestBoreholeNhn(targetX, targetZ) {
    let nearestNhn = midNHN;
    let bestDistanceSquared = Infinity;
    for (let i = 0; i < renderCardsData.length; i++) {
      const boreholePosition = positions[i];
      const dx = boreholePosition.x - targetX;
      const dz = boreholePosition.z - targetZ;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        nearestNhn = renderCardsData[i].nhn;
      }
    }
    return nearestNhn;
  }

  function refreshUserLocationMarker() {
    clearUserLocationGroup();

    const locationData = window.userLocationData;
    if (!locationData || typeof locationData.lat !== 'number' || typeof locationData.lng !== 'number') {
      return;
    }

    const { x, z } = latLonToXZ(locationData.lat, locationData.lng);
    const markerY = getNearestBoreholeNhn(x, z) + 0.08;
    const markerRadius = Math.max(0.15, gridSize * 0.008);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x5a4700, emissiveIntensity: 0.8 })
    );
    marker.position.set(x, markerY, z);
    marker.userData = { isUserLocation: true, accuracy: locationData.accuracy };
    userLocationGroup.add(marker);

    if (Number.isFinite(locationData.accuracy) && locationData.accuracy > 0) {
      const accuracyRadius = Math.min(locationData.accuracy, gridSize * 0.45);
      if (accuracyRadius > 0.1) {
        const accuracyRing = new THREE.Mesh(
          new THREE.CircleGeometry(accuracyRadius, 64),
          new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
        );
        accuracyRing.rotation.x = -Math.PI / 2;
        accuracyRing.position.set(x, markerY - 0.02, z);
        accuracyRing.renderOrder = 5;
        userLocationGroup.add(accuracyRing);
      }
    }
  }

  visualisationRuntime.userLocationUpdater = refreshUserLocationMarker;
  refreshUserLocationMarker();

  // ADD GRID
  const colorGrid = 0xdfdfdf;
  const gridHelper = new THREE.GridHelper(gridSize, divisions, colorGrid);
  gridHelper.position.y = midNHN;
  scene.add(gridHelper);
  //geometryCache.push(gridHelper); // Grid zum Cache hinzufügen

  buildTopographyOverlay(scene, gridSize, centerX, centerZ, midNHN, refLat, refLon, metersPerDegLat, metersPerDegLon);

  // Kamera automatisch zentrieren und skalieren
  const maxExtent = Math.max(maxX - minX, maxZ - minZ);
  const minDistance = 30;
  const distance = Math.max(minDistance, maxExtent * 1.5);

  camera.far = distance * 3;
  camera.updateProjectionMatrix();

  camera.position.set(centerX + distance, midNHN + distance, centerZ + distance);
  dir.position.set(centerX + distance, midNHN + distance, centerZ + distance);// Lichtposition an Kamera binden
  camera.lookAt(centerX, midNHN, centerZ);

  controls.target.set(centerX, midNHN, centerZ);
  controls.update();

  // Axes helper (groß)
  const axesSize = gridSize / 5;
  const axesHelper = new THREE.AxesHelper(axesSize);
  axesHelper.position.set(centerX, midNHN, centerZ);
  scene.add(axesHelper);

  // ADD BOREHOLES TO SCENE
  
  // CREATE CYLINDERS
  function createBoreholeGroup(x, z, layers, radius=0.04, boreholeIndex = null, boreholeTitle = '') {
    const g = new THREE.Group();
    g.userData = { boreholeIndex, boreholeTitle };
    let currentDepth = 0;
    layers.forEach((layer, idx) => {
      const h = layer.height / 100; // cm -> m
      const geom = new THREE.CylinderGeometry(radius, radius, h, 32);
      const mat = new THREE.MeshStandardMaterial({color: layer.color, roughness:0.8, metalness:0.1});
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, -(currentDepth + h/2), z);
      mesh.userData = {
        layerIndex: idx,
        layerName: layer.name,
        thickness: h,
        boreholeIndex,
        boreholeId: undefined,
        radius: radius,
        isCylinder: true,  // FLAG: kennzeichnet Zylindermeshes
        // compute cylinder volume immediately
        layerVolume: Math.PI * radius * radius * h
      };
      g.add(mesh);
      currentDepth += h;
    });
    return g;
  }

  // ADD VOLUMES TO SCENE

  // PREPARE DELAUNAY-TIN + VORONOI TILING
  // XZ-position ist für alle Höhenniveaus (Schichtgrenzen) gleich - nur Y variiert je Niveau.
  const boreholePoints = renderCardsData.map(b => {
    const { x, z } = latLonToXZ(b.coords.lat, b.coords.lng);
    return [x, z];
  });

  const halfGrid = gridSize / 2;
  const gridMinX = centerX - halfGrid;
  const gridMaxX = centerX + halfGrid;
  const gridMinZ = centerZ - halfGrid;
  const gridMaxZ = centerZ + halfGrid;

  // The support points extend the TIN to every bounding-box edge. Their elevation
  // is taken from the nearest borehole, preserving each borehole's exact NHN value.
  const boundingBoxPoints = [
    [gridMinX, gridMinZ],
    [gridMaxX, gridMinZ],
    [gridMaxX, gridMaxZ],
    [gridMinX, gridMaxZ]
  ];
  const nearestBoreholeIndex = ([x, z]) => boreholePoints.reduce((nearest, point, index) => {
    const nearestPoint = boreholePoints[nearest];
    const distance = (point[0] - x) ** 2 + (point[1] - z) ** 2;
    const nearestDistance = (nearestPoint[0] - x) ** 2 + (nearestPoint[1] - z) ** 2;
    return distance < nearestDistance ? index : nearest;
  }, 0);
  const tinPoints = [...boreholePoints, ...boundingBoxPoints];
  const tinElevations = [
    ...renderCardsData.map(borehole => borehole.nhn),
    ...boundingBoxPoints.map(point => renderCardsData[nearestBoreholeIndex(point)].nhn)
  ];
  const tinDelaunay = Delaunay.from(tinPoints);
  const triangleCount = tinDelaunay.triangles.length / 3;
  const voronoi = Delaunay.from(boreholePoints).voronoi([gridMinX, gridMinZ, gridMaxX, gridMaxZ]);
  console.log("Voronoi cells:", voronoi.cellPolygons());

  function normalizeCellPolygon(rawCell) {
    if (!rawCell || rawCell.length < 3) return null;
    const epsilon = 1e-9;
    const cell = [];
    rawCell.forEach(([x, z]) => {
      const previous = cell[cell.length - 1];
      if (!previous || Math.abs(x - previous[0]) > epsilon || Math.abs(z - previous[1]) > epsilon) {
        cell.push([x, z]);
      }
    });
    const first = cell[0];
    const last = cell[cell.length - 1];
    if (first && last && Math.abs(first[0] - last[0]) <= epsilon && Math.abs(first[1] - last[1]) <= epsilon) {
      cell.pop();
    }
    return cell.length >= 3 ? cell : null;
  }

  // --- 2D polygon helpers (all operate in the XZ plane) ---
  function polygonArea(poly) {
    let a = 0;
    for (let k = 0; k < poly.length; k++) {
      const [x1, z1] = poly[k];
      const [x2, z2] = poly[(k + 1) % poly.length];
      a += x1 * z2 - x2 * z1;
    }
    return a / 2;
  }

  // ensure positive (CCW) winding, required by clipPolygon's inside test
  function ensureCCW(poly) {
    return polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
  }

  function lineIntersect(p1, p2, p3, p4) {
    const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-12) return p2;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  // Sutherland-Hodgman: clip a (possibly non-convex/simple) subject polygon against a convex, CCW clip polygon
  function clipPolygon(subject, clip) {
    let output = subject;
    for (let i = 0; i < clip.length && output.length; i++) {
      const [ax, az] = clip[i];
      const [bx, bz] = clip[(i + 1) % clip.length];
      const input = output;
      output = [];
      for (let j = 0; j < input.length; j++) {
        const curr = input[j];
        const prev = input[(j - 1 + input.length) % input.length];
        const currInside = (bx - ax) * (curr[1] - az) - (bz - az) * (curr[0] - ax) >= 0;
        const prevInside = (bx - ax) * (prev[1] - az) - (bz - az) * (prev[0] - ax) >= 0;
        if (currInside) {
          if (!prevInside) output.push(lineIntersect(prev, curr, [ax, az], [bx, bz]));
          output.push(curr);
        } else if (prevInside) {
          output.push(lineIntersect(prev, curr, [ax, az], [bx, bz]));
        }
      }
    }
    return output;
  }


  // Y as a linear (planar) function of X/Z, defined by 3 triangle vertices + their heights - this IS the TIN.
  function makeHeightPlane(pA, yA, pB, yB, pC, yC) {
    const [x1, z1] = pA, [x2, z2] = pB, [x3, z3] = pC;
    const d1x = x2 - x1, d1z = z2 - z1, dy1 = yB - yA;
    const d2x = x3 - x1, d2z = z3 - z1, dy2 = yC - yA;
    const det = d1x * d2z - d1z * d2x;
    if (Math.abs(det) < 1e-9) {
      const avg = (yA + yB + yC) / 3;
      return () => avg;
    }
    const a = (dy1 * d2z - d1z * dy2) / det;
    const b = (d1x * dy2 - dy1 * d2x) / det;
    return (x, z) => yA + a * (x - x1) + b * (z - z1);
  }

  // Splits a Voronoi cell into patches from the complete bounding-box TIN and bakes in each patch's
  // interpolated NHN elevation. The same patch shape is reused for every layer of a borehole.
  function buildCellGroundPatches(i) {
    const rawCell = normalizeCellPolygon(voronoi.cellPolygon(i));
    if (!rawCell) return [];
    const cell = ensureCCW(rawCell);
    const patches = [];

    for (let t = 0; t < triangleCount; t++) {
      const a = tinDelaunay.triangles[t * 3];
      const b = tinDelaunay.triangles[t * 3 + 1];
      const c = tinDelaunay.triangles[t * 3 + 2];
      if (a >= tinPoints.length || b >= tinPoints.length || c >= tinPoints.length) continue;
      const tri = ensureCCW([tinPoints[a], tinPoints[b], tinPoints[c]]);
      const clipped = clipPolygon(cell, tri);
      if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > 1e-9) {
        const elevationFn = makeHeightPlane(
          tinPoints[a], tinElevations[a],
          tinPoints[b], tinElevations[b],
          tinPoints[c], tinElevations[c]
        );
        patches.push({ verts2D: clipped, elevationFn });
      }
    }

    return patches;
  }

  // Builds the tiled Voronoi-TIN volume for one layer: top = ground patch shifted down by depthTop,
  // bottom = same patch shifted down by depthBottom, connected by vertical side walls.
  function buildLayerVolumeGeometry(groundPatches, depthTop, depthBottom) {
    const positions = [];
    let totalArea = 0;

    function pushTriangle(p1, p2, p3) {
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    }

    groundPatches.forEach(patch => {
      const top3D = patch.verts2D.map(([x, z]) => new THREE.Vector3(x, patch.elevationFn(x, z) - depthTop, z));
      const bottom3D = patch.verts2D.map(([x, z]) => new THREE.Vector3(x, patch.elevationFn(x, z) - depthBottom, z));
      const n = top3D.length;

      // top cap
      for (let k = 1; k < n - 1; k++) pushTriangle(top3D[0], top3D[k], top3D[k + 1]);
      // bottom cap (reversed winding)
      for (let k = 1; k < n - 1; k++) pushTriangle(bottom3D[0], bottom3D[k + 1], bottom3D[k]);
      // vertical side walls (top/bottom share the same XZ-shape, only Y differs by a constant)
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        pushTriangle(top3D[k], bottom3D[k], top3D[k2]);
        pushTriangle(bottom3D[k], bottom3D[k2], top3D[k2]);
      }

      totalArea += Math.abs(polygonArea(patch.verts2D));
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    return { geometry, area: totalArea, volume: totalArea * (depthBottom - depthTop) };
  }

  // CREATE MESHS
  async function buildModel() {
    const volumes = {};
    const ifcMeshes = []; // Sammle Meshes für IFC-Export
    const boreholeCylinderGroup = new THREE.Group();
    boreholeCylinderGroup.name = 'borehole-cylinders';
    boreholeCylinderGroup.visible = window.boreholeCylindersVisible !== false;
    window.boreholeCylinderGroup = boreholeCylinderGroup;
    scene.add(boreholeCylinderGroup);

    const spreadVolumeGroup = new THREE.Group();
    spreadVolumeGroup.name = 'spread-volumes';
    spreadVolumeGroup.visible = window.spreadVolumesVisible !== false;
    window.spreadVolumeGroup = spreadVolumeGroup;
    scene.add(spreadVolumeGroup);

    // Berechne Origin für IFC (erster Bohrpunkt)
    const firstBorehole = renderCardsData[0];
    const originXZ = latLonToXZ(firstBorehole.coords.lat, firstBorehole.coords.lng);
    const ifcOrigin = {
      x: originXZ.x,
      y: firstBorehole.nhn,
      z: originXZ.z
    };
    publishRummzIfcSnapshot(renderCardsData, ifcMeshes, ifcOrigin);
    
    // Zylinder-Meshes sammeln und hinzufügen
    renderCardsData.forEach((bh, bhIndex) => {
      const p = latLonToXZ(bh.coords.lat, bh.coords.lng);
      const grp = createBoreholeGroup(p.x, p.z, bh.layers, 0.04, bhIndex, bh.title || '');
      grp.name = bh.id;
      grp.userData.boreholeId = bh.id;
      grp.position.y = bh.nhn;
      boreholeCylinderGroup.add(grp);
      // WICHTIG: Zylindermeshes zu IFC-Export-Array hinzufügen
      grp.children.forEach(cylinderMesh => {
        ifcMeshes.push(cylinderMesh);
      });
      console.log(grp);
    });

    // Voronoi-Zell-Patches folgen der Geländeform (NHN-TIN) und sind für alle Schichten einer Bohrung identisch -> einmal berechnen
    const cellGroundPatches = renderCardsData.map((_, i) => buildCellGroundPatches(i));

    for (let i = 0; i < renderCardsData.length; i++) {
      const borehole = renderCardsData[i];
      const groundPatches = cellGroundPatches[i];
      if (!groundPatches || groundPatches.length === 0) continue;

      let depthTop = 0; // kumulierte Tiefe unter NHN, wie yOffset in three-plane.js

      for (let layerIndex = 0; layerIndex < borehole.layers.length; layerIndex++) {
        const layer = borehole.layers[layerIndex];
        const depthBottom = depthTop + layer.height / 100;

        const { geometry, area, volume } = buildLayerVolumeGeometry(groundPatches, depthTop, depthBottom);
        depthTop = depthBottom;

        console.log(`Bohrung ${i+1} - Schicht ${layerIndex+1} (${layer.name}): Fläche = ${area.toFixed(2)} m², Volumen = ${volume.toFixed(2)} m³`);

        if (layer.name) {
            if (!volumes[layer.name]) {
                volumes[layer.name] = { volume: 0, color: layer.color };
            }
            volumes[layer.name].volume += volume;
        }

        const material = new THREE.MeshStandardMaterial({
          color: layer.color,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
        const mesh = new THREE.Mesh(geometry, material);

        // set metadata for raycast info (layerName, thickness, per-cell volume, borehole index, layer index)
        mesh.userData = {
          layerName: layer.name,
          layerThickness: layer.height / 100,
          layerArea: area,
          layerVolume: volume,
          boreholeIndex: i,
          layerIndex
        };

        spreadVolumeGroup.add(mesh);

        ifcMeshes.push(mesh); // Mesh für IFC sammeln
      }
    }
    publishRummzIfcSnapshot(renderCardsData, ifcMeshes, ifcOrigin);
    updateCharts(renderCardsData, volumes);
  }
  
  buildModel();
      
  function animate(){
    visualisationRuntime.animationFrameId = requestAnimationFrame(animate);
    //controls.update();
    renderer.render(scene, camera);
  }

  // RAYCASTER
  // --- Raycaster / Pointer interaction (adds selection highlight + info overlay) ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let isDragging = false;
  let pointerDownPos = { x: 0, y: 0 };
  const dragThreshold = 5; // pixels
  let selected = null;

  // Helper: get normalized pointer coords and client coords
  function getPointerClient(e) {
    const rect = container.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    return {
      clientX,
      clientY,
      nx: ((clientX - rect.left) / rect.width) * 2 - 1,
      ny: -((clientY - rect.top) / rect.height) * 2 + 1
    };
  }

  // Create a small overlay for info (or reuse if existing)
  let infoOverlay = document.getElementById('rummz-ray-info');
  if (!infoOverlay) {
    infoOverlay = document.createElement('div');
    infoOverlay.id = 'rummz-ray-info';
    infoOverlay.style.position = 'absolute';
    infoOverlay.style.left = '0';
    infoOverlay.style.top = '0';
    infoOverlay.style.padding = '0.25rem';
    infoOverlay.style.fontSize = '12px';
    infoOverlay.style.zIndex = 50;
    infoOverlay.style.maxWidth = '240px';
    // ensure container is positioned
    container.style.position = container.style.position || 'relative';
    container.appendChild(infoOverlay);
  }

  function showInspectionHint() {
    infoOverlay.replaceChildren();
    infoOverlay.style.padding = '0.08rem 0.2rem';
    infoOverlay.style.background = 'rgba(0, 0, 0, 0.45)';
    infoOverlay.style.color = '#fff';
    infoOverlay.style.fontSize = '8px';
    infoOverlay.style.pointerEvents = 'none';
    infoOverlay.innerText = 'Click an object to inspect';
  }

  function showInspectionDetails(infoText) {
    infoOverlay.replaceChildren();
    infoOverlay.style.padding = '0.15rem 0.25rem';
    infoOverlay.style.background = 'rgba(0, 0, 0, 0.55)';
    infoOverlay.style.color = '#fff';
    infoOverlay.style.fontSize = '9px';
    infoOverlay.style.pointerEvents = 'none';
    infoOverlay.innerText = infoText;
  }

  showInspectionHint();

  // Outline highlight: create a slightly scaled backside clone for halo
  function addHighlight(mesh) {
    if (!mesh) return;
    // If group, add outline to each child mesh
    if (mesh.type === 'Group' || (mesh.children && mesh.children.length > 0 && !mesh.geometry)) {
      mesh.children.forEach(ch => addHighlight(ch));
      return;
    }
    if (mesh.userData._rummz_outline) return;

    // Draw only the silhouette so the selected mesh keeps its original material colors.
    const geom = mesh.geometry ? mesh.geometry.clone() : null;
    if (!geom) return;

    const outlineGeometry = new THREE.EdgesGeometry(geom);
    geom.dispose();
    const outlineMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 4, depthTest: false, depthWrite: false });
    const outlineMesh = new THREE.LineSegments(outlineGeometry, outlineMat);
    outlineMesh.name = '_rummz_outline';
    outlineMesh.renderOrder = 9999;

    // Save reference and attach to mesh (so it follows transforms)
    mesh.add(outlineMesh);
    mesh.userData._rummz_outline = outlineMesh;
  }

  function removeHighlight(mesh) {
    if (!mesh) return;
    if (mesh.type === 'Group' || (mesh.children && mesh.children.length > 0 && !mesh.geometry)) {
      mesh.children.forEach(ch => removeHighlight(ch));
      return;
    }
    const outline = mesh.userData._rummz_outline;
    if (outline) {
      mesh.remove(outline);
      if (outline.geometry) outline.geometry.dispose();
      if (outline.material) outline.material.dispose();
      delete mesh.userData._rummz_outline;
    }
  }

  // Find top-level group for borehole (optional)
  function findBoreholeGroup(obj) {
    let cur = obj;
    while (cur) {
      if (cur.type === 'Group' && typeof cur.userData?.boreholeIndex === 'number') return cur;
      cur = cur.parent;
    }
    return obj;
  }

  // On pointer down
  function onPointerDown(e) {
    const p = getPointerClient(e);
    pointerDownPos.x = p.clientX;
    pointerDownPos.y = p.clientY;
    isDragging = false;
  }

  // On pointer move -> detect drag
  function onPointerMove(e) {
    const p = getPointerClient(e);
    if (Math.hypot(p.clientX - pointerDownPos.x, p.clientY - pointerDownPos.y) > dragThreshold) {
      isDragging = true;
    }
  }

  // On pointer up -> if not dragging treat as click
  function onPointerUp(e) {
    const p = getPointerClient(e);
    if (isDragging) return;
    pointer.x = p.nx;
    pointer.y = p.ny;
    raycaster.setFromCamera(pointer, camera);
    const selectableGroups = [window.boreholeCylinderGroup, window.spreadVolumeGroup].filter(Boolean);
    const intersects = raycaster.intersectObjects(selectableGroups, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      const clickedObject = hit.object;
      const topGroup = findBoreholeGroup(clickedObject);

      // clear previous
      if (selected && selected !== topGroup) {
        removeHighlight(selected);
      }

      selected = topGroup;
      addHighlight(selected);

      // Show info in overlay + console
      const user = clickedObject.userData || {};
      let boreholeIndex = user.boreholeIndex;
      // if not on mesh, try parent group
      if (boreholeIndex === undefined) {
        const group = topGroup && topGroup.userData ? topGroup.userData : null;
        if (group && group.boreholeIndex !== undefined) boreholeIndex = group.boreholeIndex;
      }
      const bhIndex = (typeof boreholeIndex === 'number') ? boreholeIndex : null;
      const bhData = (bhIndex !== null && renderCardsData[bhIndex]) ? renderCardsData[bhIndex] : null;
      const boreholeNumber = (bhIndex !== null) ? (bhIndex + 1) : 'n/a';
      const boreholeTitle = bhData ? (bhData.title || '') : '';

      // Layer info: prefer explicit layerName/thickness/volume from userData
      const layerName = user.layerName || (user.layerIndex !== undefined && bhData ? (bhData.layers[user.layerIndex] && bhData.layers[user.layerIndex].name) : 'n/a');
      const layerThickness = (user.thickness || user.layerThickness) ? (user.thickness || user.layerThickness) : (user.layerIndex !== undefined && bhData ? (bhData.layers[user.layerIndex] && (bhData.layers[user.layerIndex].height/100)) : undefined);
      let layerVolume = user.layerVolume;
      let layerArea = user.layerArea;
      if (layerVolume === undefined && user.layerIndex !== undefined && bhData) {
        // compute cylinder volume (if this was cylinder)
        const r = user.radius || 0.04;
        if (layerThickness) layerVolume = Math.PI * r * r * layerThickness;
      }
      // Format values
      const thicknessText = layerThickness !== undefined ? `${layerThickness.toFixed(2)} m` : 'n/a';
      const areaText = user.layerArea !== undefined ? `${user.layerArea.toFixed(2)} m²` : 'n/a';
      const volumeText = layerVolume !== undefined ? `${layerVolume.toFixed(2)} m³` : 'n/a';

      const infoLines = [
        `Bohrung: ${boreholeNumber}${boreholeTitle ? ' ' + boreholeTitle : ''}`,
        `Schicht: ${layerName}`,
        `Schichthöhe: ${thicknessText}`,
        `Schichtfläche: ${areaText}`,
        `Volumen: ${volumeText}`,
        `Treffpunkt Y: ${hit.point.y.toFixed(2)}`
      ];
      showInspectionDetails(infoLines.join('\n'));
      console.log('RUMMZ ray hit:', {
        boreholeIndex: bhIndex,
        boreholeTitle,
        layerName,
        layerThickness,
        layerVolume,
        hitPoint: hit.point,
        object: clickedObject
      });
    } else {
      // click on empty space: clear selection
      if (selected) {
        removeHighlight(selected);
        selected = null;
        showInspectionHint();
      }
    }
  }

  // Add / remove pointer event listeners safely (avoid duplicates)
  function setupRayListeners() {
    // Remove previous if present
    if (container._rummz_ray_handlers) {
      const h = container._rummz_ray_handlers;
      container.removeEventListener('pointerdown', h.down);
      container.removeEventListener('pointermove', h.move);
      container.removeEventListener('pointerup', h.up);
      container.removeEventListener('pointercancel', h.up);
    }
    const handlers = {
      down: onPointerDown,
      move: onPointerMove,
      up: onPointerUp
    };
    container.addEventListener('pointerdown', handlers.down);
    container.addEventListener('pointermove', handlers.move);
    container.addEventListener('pointerup', handlers.up);
    container.addEventListener('pointercancel', handlers.up);
    container._rummz_ray_handlers = handlers;
    visualisationRuntime.rayHandlers = handlers;
  }

  // initialize listeners
  setupRayListeners();
  // --- end raycaster section ---


  animate();
  
  };

if (!window.__rummzDgmUpdateVisualisationListenerBound) {
  window.addEventListener('updateVisualisation', function(event) {
    if (window.rummzVisualisationMode !== 'dgm') return;
    const cardsData = event?.detail?.cardsData;
    updateVisualisation(cardsData);
  });
  window.__rummzDgmUpdateVisualisationListenerBound = true;
}