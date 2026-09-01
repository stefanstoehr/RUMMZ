import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';

let groundwaterGroup = null;
let latestCardsData = [];
let groundwaterRebuildVersion = 0;

function disposeGroundwaterGroup() {
  if (!groundwaterGroup) return;
  groundwaterGroup.traverse(object => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach(material => material.dispose());
    } else {
      object.material?.dispose();
    }
  });
  groundwaterGroup.parent?.remove(groundwaterGroup);
  groundwaterGroup = null;
  window.groundwaterGroup = null;
}

function isRenderableLayer(layer) {
  return !!layer
    && typeof layer.name === 'string'
    && layer.name.trim() !== ''
    && typeof layer.height === 'number'
    && layer.height > 0
    && typeof layer.color === 'string'
    && layer.color.trim() !== '';
}

function isRenderableBorehole(borehole) {
  return !!borehole
    && borehole.coords
    && typeof borehole.coords.lat === 'number'
    && typeof borehole.coords.lng === 'number'
    && typeof borehole.nhn === 'number'
    && Array.isArray(borehole.layers)
    && borehole.layers.some(isRenderableLayer);
}

function parseElevation(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  return normalized === '' ? null : Number(normalized);
}

function getGroundwaterInterval(layer) {
  const water = layer?.info?.water;
  if (water?.groundwaterActive !== true) return null;

  const upper = parseElevation(water.groundwaterFrom);
  const lower = parseElevation(water.groundwaterTo);
  return Number.isFinite(upper) && Number.isFinite(lower) && upper >= lower
    ? { upper, lower }
    : null;
}

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

function buildGroundwaterGeometry(cell, interval, scaleXZ) {
  const shape = new THREE.Shape();
  cell.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: interval.upper - interval.lower,
    bevelEnabled: false
  });
  geometry.rotateX(Math.PI / 2);

  const center = cell.reduce((result, [x, z]) => ({ x: result.x + x, z: result.z + z }), { x: 0, z: 0 });
  center.x /= cell.length;
  center.z /= cell.length;

  return { geometry, center };
}

function rebuildGroundwater(cardsData) {
  latestCardsData = Array.isArray(cardsData) ? cardsData : [];
  disposeGroundwaterGroup();
  if (window.rummzVisualisationMode === 'dgm' || !window.scene || window.groundwaterVisible !== true) return;

  const renderCardsData = Array.isArray(cardsData)
    ? cardsData
      .filter(isRenderableBorehole)
      .map(borehole => ({ ...borehole, layers: borehole.layers.filter(isRenderableLayer) }))
    : [];
  if (renderCardsData.length === 0) return;

  const refLat = renderCardsData.reduce((sum, borehole) => sum + borehole.coords.lat, 0) / renderCardsData.length;
  const refLon = renderCardsData.reduce((sum, borehole) => sum + borehole.coords.lng, 0) / renderCardsData.length;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(refLat * Math.PI / 180);
  const toXZ = (lat, lon) => ({
    x: (lon - refLon) * metersPerDegLon,
    z: (refLat - lat) * metersPerDegLat
  });

  const positions = renderCardsData.map(borehole => toXZ(borehole.coords.lat, borehole.coords.lng));
  const minX = Math.min(...positions.map(position => position.x));
  const maxX = Math.max(...positions.map(position => position.x));
  const minZ = Math.min(...positions.map(position => position.z));
  const maxZ = Math.max(...positions.map(position => position.z));
  const gridSize = Math.max(20, Math.max(maxX - minX, maxZ - minZ) * (2 - (Number(window.rummzVisualControls?.boundingbox || 0) / 100)));
  const center = toXZ(refLat, refLon);
  const halfGrid = gridSize / 2;
  const voronoi = Delaunay.from(positions.map(position => [position.x, position.z]))
    .voronoi([center.x - halfGrid, center.z - halfGrid, center.x + halfGrid, center.z + halfGrid]);
  const spacing = Math.max(0, Math.min(25, Number(window.rummzVisualControls?.layerSpacing || 0)));
  const scaleXZ = 1 - ((spacing / 25) * 0.15);

  groundwaterGroup = new THREE.Group();
  groundwaterGroup.name = 'groundwater-volumes';
  groundwaterGroup.visible = true;
  window.groundwaterGroup = groundwaterGroup;
  window.scene.add(groundwaterGroup);

  const material = new THREE.MeshPhysicalMaterial({
    color: 0x159fba,
    transparent: true,
    opacity: 0.58,
    roughness: 0.2,
    metalness: 0.2,
    emissive: 0x075b72,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  renderCardsData.forEach((borehole, boreholeIndex) => {
    const cell = normalizeCellPolygon(voronoi.cellPolygon(boreholeIndex));
    if (!cell) return;

    borehole.layers.forEach((layer, layerIndex) => {
      const interval = getGroundwaterInterval(layer);
      if (!interval || interval.upper === interval.lower) return;

      const { geometry, center: cellCenter } = buildGroundwaterGeometry(cell, interval, scaleXZ);
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.scale.set(scaleXZ, 1, scaleXZ);
      mesh.position.set(
        cellCenter.x * (1 - scaleXZ),
        interval.upper,
        cellCenter.z * (1 - scaleXZ)
      );
      mesh.renderOrder = 2;
      mesh.userData = {
        isGroundwater: true,
        boreholeId: borehole.id,
        layerIndex,
        groundwaterUpper: interval.upper,
        groundwaterLower: interval.lower
      };
      groundwaterGroup.add(mesh);
    });
  });
  material.dispose();
}

if (!window.__rummzGroundwaterToggleListenerBound) {
  window.addEventListener('toggleGroundwater', event => {
    window.groundwaterVisible = event.detail?.visible === true;
    if (!window.groundwaterVisible && groundwaterGroup) {
      groundwaterGroup.visible = false;
    }
  });
  window.__rummzGroundwaterToggleListenerBound = true;
}

if (!window.__rummzGroundwaterPlaneListenerBound) {
  window.addEventListener('updateVisualisation', event => {
    if (window.rummzVisualisationMode !== 'dgm') {
      const cardsData = event.detail?.cardsData;
      const rebuildVersion = ++groundwaterRebuildVersion;
      queueMicrotask(() => {
        if (rebuildVersion === groundwaterRebuildVersion) {
          rebuildGroundwater(cardsData);
        }
      });
    }
  });
  window.__rummzGroundwaterPlaneListenerBound = true;
}

if (!window.__rummzGroundwaterModeSwitchListenerBound) {
  window.addEventListener('switchVisualisationMode', event => {
    if (event.detail?.previousMode === 'plane') disposeGroundwaterGroup();
  });
  window.__rummzGroundwaterModeSwitchListenerBound = true;
}
