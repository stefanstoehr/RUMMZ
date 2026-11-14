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
    && Number.isFinite(borehole.coords.lat)
    && Number.isFinite(borehole.coords.lng)
    && Number.isFinite(borehole.nhn)
    && Array.isArray(borehole.layers)
    && borehole.layers.some(isRenderableLayer);
}

function parseElevation(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  return normalized === '' ? null : Number(normalized);
}

function getGroundwaterIntervals(borehole) {
  return borehole.layers.map((layer, layerIndex) => {
    const water = layer?.info?.water;
    if (water?.groundwaterActive !== true) return null;

    const upper = parseElevation(water.groundwaterFrom);
    const lower = parseElevation(water.groundwaterTo);
    return Number.isFinite(upper) && Number.isFinite(lower) && upper >= lower
      ? { layerIndex, upper, lower }
      : null;
  }).filter(Boolean);
}

function polygonArea(poly) {
  let area = 0;
  for (let index = 0; index < poly.length; index++) {
    const [x1, z1] = poly[index];
    const [x2, z2] = poly[(index + 1) % poly.length];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

function ensureCCW(poly) {
  return polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
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

function lineIntersect(p1, p2, p3, p4) {
  const [x1, z1] = p1;
  const [x2, z2] = p2;
  const [x3, z3] = p3;
  const [x4, z4] = p4;
  const denominator = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-12) return p2;

  const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denominator;
  return [x1 + t * (x2 - x1), z1 + t * (z2 - z1)];
}

function clipPolygon(subject, clip) {
  let output = subject;
  for (let index = 0; index < clip.length && output.length; index++) {
    const [ax, az] = clip[index];
    const [bx, bz] = clip[(index + 1) % clip.length];
    const input = output;
    output = [];
    for (let vertexIndex = 0; vertexIndex < input.length; vertexIndex++) {
      const current = input[vertexIndex];
      const previous = input[(vertexIndex - 1 + input.length) % input.length];
      const currentInside = (bx - ax) * (current[1] - az) - (bz - az) * (current[0] - ax) >= 0;
      const previousInside = (bx - ax) * (previous[1] - az) - (bz - az) * (previous[0] - ax) >= 0;
      if (currentInside) {
        if (!previousInside) output.push(lineIntersect(previous, current, [ax, az], [bx, bz]));
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersect(previous, current, [ax, az], [bx, bz]));
      }
    }
  }
  return output;
}

function makeHeightPlane(pA, yA, pB, yB, pC, yC) {
  const [x1, z1] = pA;
  const [x2, z2] = pB;
  const [x3, z3] = pC;
  const d1x = x2 - x1;
  const d1z = z2 - z1;
  const dy1 = yB - yA;
  const d2x = x3 - x1;
  const d2z = z3 - z1;
  const dy2 = yC - yA;
  const determinant = d1x * d2z - d1z * d2x;
  if (Math.abs(determinant) < 1e-9) {
    const average = (yA + yB + yC) / 3;
    return () => average;
  }

  const a = (dy1 * d2z - d1z * dy2) / determinant;
  const b = (d1x * dy2 - dy1 * d2x) / determinant;
  return (x, z) => yA + a * (x - x1) + b * (z - z1);
}

function buildCellGroundPatches(cellIndex, voronoi, triangles, tinPoints, tinElevations) {
  const rawCell = normalizeCellPolygon(voronoi.cellPolygon(cellIndex));
  if (!rawCell) return [];
  const cell = ensureCCW(rawCell);
  const patches = [];

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 3) {
    const a = triangles[triangleIndex];
    const b = triangles[triangleIndex + 1];
    const c = triangles[triangleIndex + 2];
    if (a >= tinPoints.length || b >= tinPoints.length || c >= tinPoints.length) continue;

    const triangle = ensureCCW([tinPoints[a], tinPoints[b], tinPoints[c]]);
    const clipped = clipPolygon(cell, triangle);
    if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > 1e-9) {
      patches.push({
        verts2D: clipped,
        elevationFn: makeHeightPlane(
          tinPoints[a], tinElevations[a],
          tinPoints[b], tinElevations[b],
          tinPoints[c], tinElevations[c]
        )
      });
    }
  }

  return patches;
}

function buildGroundwaterGeometry(groundPatches, depthTop, depthBottom) {
  const positions = [];
  const pushTriangle = (p1, p2, p3) => {
    positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
  };
  const edgeKey = (start, end) => {
    const formatPoint = ([x, z]) => `${x.toFixed(6)},${z.toFixed(6)}`;
    const points = [formatPoint(start), formatPoint(end)].sort();
    return points.join('|');
  };
  const edgeCounts = new Map();

  const preparedPatches = groundPatches.map(patch => {
    const top = patch.verts2D.map(([x, z]) => new THREE.Vector3(x, patch.elevationFn(x, z) - depthTop, z));
    const bottom = patch.verts2D.map(([x, z]) => new THREE.Vector3(x, patch.elevationFn(x, z) - depthBottom, z));
    patch.verts2D.forEach((start, index) => {
      const end = patch.verts2D[(index + 1) % patch.verts2D.length];
      const key = edgeKey(start, end);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    });
    return { top, bottom, verts2D: patch.verts2D };
  });

  preparedPatches.forEach(({ top, bottom, verts2D }) => {
    for (let index = 1; index < top.length - 1; index++) {
      pushTriangle(top[0], top[index], top[index + 1]);
      pushTriangle(bottom[0], bottom[index + 1], bottom[index]);
    }
    for (let index = 0; index < top.length; index++) {
      const next = (index + 1) % top.length;
      if (edgeCounts.get(edgeKey(verts2D[index], verts2D[next])) > 1) continue;
      pushTriangle(top[index], bottom[index], top[next]);
      pushTriangle(bottom[index], bottom[next], top[next]);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function rebuildGroundwater(cardsData) {
  latestCardsData = Array.isArray(cardsData) ? cardsData : [];
  disposeGroundwaterGroup();
  if (window.rummzVisualisationMode !== 'dgm' || !window.scene || window.groundwaterVisible !== true) return;

  const renderCardsData = latestCardsData
    .filter(isRenderableBorehole)
    .map(borehole => ({ ...borehole, layers: borehole.layers.filter(isRenderableLayer) }));
  if (renderCardsData.length === 0) return;

  const refLat = renderCardsData.reduce((sum, borehole) => sum + borehole.coords.lat, 0) / renderCardsData.length;
  const refLon = renderCardsData.reduce((sum, borehole) => sum + borehole.coords.lng, 0) / renderCardsData.length;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(refLat * Math.PI / 180);
  const toXZ = (lat, lon) => [
    (lon - refLon) * metersPerDegLon,
    (refLat - lat) * metersPerDegLat
  ];
  const boreholePoints = renderCardsData.map(borehole => toXZ(borehole.coords.lat, borehole.coords.lng));
  const minX = Math.min(...boreholePoints.map(([x]) => x));
  const maxX = Math.max(...boreholePoints.map(([x]) => x));
  const minZ = Math.min(...boreholePoints.map(([, z]) => z));
  const maxZ = Math.max(...boreholePoints.map(([, z]) => z));
  const boundingBoxValue = Number(window.rummzVisualControls?.boundingbox || 0);
  const boundingBoxPercent = Number.isFinite(boundingBoxValue) ? Math.max(0, Math.min(100, boundingBoxValue)) : 0;
  const boundingBoxScale = 2 - (boundingBoxPercent / 100);
  const gridSize = Math.max(20, Math.max(maxX - minX, maxZ - minZ) * boundingBoxScale);
  const halfGrid = gridSize / 2;
  const box = [
    [-halfGrid, -halfGrid],
    [halfGrid, -halfGrid],
    [halfGrid, halfGrid],
    [-halfGrid, halfGrid]
  ];
  const nearestBoreholeIndex = ([x, z]) => boreholePoints.reduce((nearest, point, index) => {
    const nearestPoint = boreholePoints[nearest];
    const distance = (point[0] - x) ** 2 + (point[1] - z) ** 2;
    const nearestDistance = (nearestPoint[0] - x) ** 2 + (nearestPoint[1] - z) ** 2;
    return distance < nearestDistance ? index : nearest;
  }, 0);
  const tinPoints = [...boreholePoints, ...box];
  const tinElevations = [
    ...renderCardsData.map(borehole => borehole.nhn),
    ...box.map(point => renderCardsData[nearestBoreholeIndex(point)].nhn)
  ];
  const tinDelaunay = Delaunay.from(tinPoints);
  const voronoi = Delaunay.from(boreholePoints).voronoi([-halfGrid, -halfGrid, halfGrid, halfGrid]);
  const cellGroundPatches = renderCardsData.map((_, index) => buildCellGroundPatches(
    index,
    voronoi,
    tinDelaunay.triangles,
    tinPoints,
    tinElevations
  ));

  groundwaterGroup = new THREE.Group();
  groundwaterGroup.name = 'groundwater-volumes-dgm';
  groundwaterGroup.visible = true;
  window.groundwaterGroup = groundwaterGroup;
  window.scene.add(groundwaterGroup);

  const baseMaterial = new THREE.MeshPhysicalMaterial({
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
    const groundPatches = cellGroundPatches[boreholeIndex];
    if (groundPatches.length === 0) return;

    getGroundwaterIntervals(borehole).forEach(({ layerIndex, upper, lower }) => {
      if (upper === lower) return;
      const geometry = buildGroundwaterGeometry(
        groundPatches,
        borehole.nhn - upper,
        borehole.nhn - lower
      );
      if (geometry.getAttribute('position').count === 0) {
        geometry.dispose();
        return;
      }

      const mesh = new THREE.Mesh(geometry, baseMaterial.clone());
      mesh.renderOrder = 2;
      mesh.userData = {
        isGroundwater: true,
        boreholeId: borehole.id,
        layerIndex,
        groundwaterUpper: upper,
        groundwaterLower: lower
      };
      groundwaterGroup.add(mesh);
    });
  });
  baseMaterial.dispose();
}

if (!window.__rummzGroundwaterDgmToggleListenerBound) {
  window.addEventListener('toggleGroundwater', event => {
    window.groundwaterVisible = event.detail?.visible === true;
    if (window.groundwaterVisible && window.rummzVisualisationMode === 'dgm') {
      rebuildGroundwater(latestCardsData);
    } else if (groundwaterGroup) {
      groundwaterGroup.visible = false;
    }
  });
  window.__rummzGroundwaterDgmToggleListenerBound = true;
}

if (!window.__rummzGroundwaterDgmUpdateListenerBound) {
  window.addEventListener('updateVisualisation', event => {
    latestCardsData = Array.isArray(event.detail?.cardsData) ? event.detail.cardsData : [];
    if (window.rummzVisualisationMode !== 'dgm') return;

    const rebuildVersion = ++groundwaterRebuildVersion;
    queueMicrotask(() => {
      if (rebuildVersion === groundwaterRebuildVersion) {
        rebuildGroundwater(latestCardsData);
      }
    });
  });
  window.__rummzGroundwaterDgmUpdateListenerBound = true;
}

if (!window.__rummzGroundwaterDgmModeSwitchListenerBound) {
  window.addEventListener('switchVisualisationMode', event => {
    if (event.detail?.previousMode === 'dgm') {
      groundwaterRebuildVersion++;
      disposeGroundwaterGroup();
    }
  });
  window.__rummzGroundwaterDgmModeSwitchListenerBound = true;
}
