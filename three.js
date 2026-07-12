import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Delaunay } from 'd3-delaunay';
import { updateCharts } from './chart.js';
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { analyzeGeometry, generateIFCFaceSet, generateIFCBoxSet } from './ifc.js';

function updateVisualisation (cardsData) {

  // VALIDATE ONLY THE DATA FOR VISUALIZATION

  // Speichere Bohrdaten global für IFC-Export
  window.cardsData = cardsData;

  function validateBorehole(borehole) {
    // CONTROL MAIN DATA
    if (
      typeof borehole.coords !== "object" ||
      typeof borehole.nhn !== "number" ||
      !Array.isArray(borehole.layers) ||
      borehole.layers.length === 0
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
    // CONTROL LAYERS
    for (const layer of borehole.layers) {
      if (
        //typeof layer.id !== "string" ||
        typeof layer.name !== "string" ||
        typeof layer.height !== "number" ||
        //layer.height <= 0 ||
        typeof layer.color !== "string"
      ) {
        return false;
      }
    }
    return true;
  }

  function validatecardsData(cardsData) {
    return cardsData.every(validateBorehole);
  }

  if (!validatecardsData(cardsData)) {
    // alert("Fehler: Mindestens ein Bohrkern ist ungültig!");
  } else {

  // CLEAN THREE.JS-SCENE

  function disposeObject(obj) {
    // GEOM
    if (obj.geometry) obj.geometry.dispose();

    // MATERIAL
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(mat => mat.dispose());
      } else {
        obj.material.dispose();
      }
    }
    // GROUP
    if (obj.children) {
      obj.children.forEach(child => disposeObject(child));
    }
  }

  function clearEntireScene() {
    while (scene.children.length > 0) {
      const obj = scene.children[0];
      scene.remove(obj);
      disposeObject(obj);
    }
  }

  // INITIALIZE THREE.JS
  const scene = new THREE.Scene();
  scene.background = null;
  window.scene = scene; // GLOBAL FOR EXPORT

  clearEntireScene();

  const container = document.getElementById('dashboard-map');
  if (!container) return;

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

  // Lights
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff,0.4));
    
  // GEO-CENTER DER BOHRUNGEN ALS LAT/LON
  const refLat = cardsData.reduce((s,b)=>s+b.coords.lat,0)/cardsData.length;
  const refLon = cardsData.reduce((s,b)=>s+b.coords.lng,0)/cardsData.length;

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
  const boreholeCenters = cardsData.map(bh => {
    const depth = bh.layers.reduce((sum, layer) => sum + layer.height / 100, 0);
    return bh.nhn - depth / 2;
  });
  const minNHN = Math.min(...boreholeCenters);
  const maxNHN = Math.max(...boreholeCenters);
  const midNHN = (minNHN + maxNHN) / 2;

  // CALC X/Z-POS OF DRILL CORES
  const positions = cardsData.map(bh => latLonToXZ(bh.coords.lat, bh.coords.lng));

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
  boreholeMarkerGroup.visible = false;
  window.boreholeMarkerGroup = boreholeMarkerGroup;
  window.boreholeMarkersVisible = false;

  cardsData.forEach((bh, bhIndex) => {
    const { x, z } = latLonToXZ(bh.coords.lat, bh.coords.lng);
    const markerRoot = new THREE.Group();
    markerRoot.position.set(x, bh.nhn + 0.25, z);
    markerRoot.userData = { boreholeIndex: bhIndex, boreholeId: bh.id, isMarker: true };

    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d6efd,
      emissive: 0x0d6efd,
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.2
    });

    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), markerMaterial);
    pin.position.y = 0.06;
    markerRoot.add(pin);

    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.045, 10), markerMaterial);
    head.position.y = 0.14;
    markerRoot.add(head);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(12, 18, 30, 0.85)';
      ctx.fillRect(2, 2, 60, 28);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeRect(2, 2, 60, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bhIndex + 1), 32, 16);
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
    label.position.y = 0.18;
    label.scale.set(0.16, 0.08, 1);
    markerRoot.add(label);

    boreholeMarkerGroup.add(markerRoot);
  });

  scene.add(boreholeMarkerGroup);

  // ADD GRID
  const colorGrid = 0xdfdfdf;
  const gridHelper = new THREE.GridHelper(gridSize, divisions, colorGrid);
  gridHelper.position.y = midNHN;
  scene.add(gridHelper);
  //geometryCache.push(gridHelper); // Grid zum Cache hinzufügen

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
      
  // PREPARE VORONOIS
  const points = cardsData.map(b => {
    const { x, z } = latLonToXZ(b.coords.lat, b.coords.lng);
    return [x, z];
  });

  const delaunay = Delaunay.from(points);

  const halfGrid = gridSize / 2;
  const gridMinX = centerX - halfGrid;
  const gridMaxX = centerX + halfGrid;
  const gridMinZ = centerZ - halfGrid;
  const gridMaxZ = centerZ + halfGrid;

  const voronoi = delaunay.voronoi([gridMinX, gridMinZ, gridMaxX, gridMaxZ]);
  console.log("Voronoi cells:", voronoi.cellPolygons());

  function sortPolygonPoints(points) {
    // CALC CENTER
    const center = points.reduce(
      (acc, [x, z]) => {
        acc.x += x;
        acc.z += z;
        return acc;
      },
      { x: 0, z: 0 }
    );
    center.x /= points.length;
    center.z /= points.length;

    // SORT POINTS
    return [...points].sort(([xA, zA], [xB, zB]) => {
      const angleA = Math.atan2(zA - center.z, xA - center.x);
      const angleB = Math.atan2(zB - center.z, xB - center.x);
      return angleA - angleB; // NOT CLOCKWISE
    });
  }

  // CREATE MESHS
  async function buildModel() {
    const volumes = {};
    window.ifcMeshes = []; // Sammle Meshes für IFC-Export
    // Berechne Origin für IFC (erster Bohrpunkt)
    const firstBorehole = cardsData[0];
    const originXZ = latLonToXZ(firstBorehole.coords.lat, firstBorehole.coords.lng);
    window.ifcOrigin = {
      x: originXZ.x,
      y: firstBorehole.nhn,
      z: originXZ.z
    };
    
    // Zylinder-Meshes sammeln und hinzufügen
    cardsData.forEach((bh, bhIndex) => {
      const p = latLonToXZ(bh.coords.lat, bh.coords.lng);
      const grp = createBoreholeGroup(p.x, p.z, bh.layers, 0.04, bhIndex, bh.title || '');
      grp.name = bh.id;
      grp.userData.boreholeId = bh.id;
      grp.position.y = bh.nhn;
      scene.add(grp);
      // WICHTIG: Zylindermeshes zu IFC-Export-Array hinzufügen
      grp.children.forEach(cylinderMesh => {
        window.ifcMeshes.push(cylinderMesh);
      });
      console.log(grp);
    });
    
    for (let i = 0; i < cardsData.length; i++) {
      const borehole = cardsData[i];
      const rawCell = voronoi.cellPolygon(i);
      const cell = sortPolygonPoints(rawCell);

      if (!cell) continue;

      let yOffset = borehole.nhn;

      for (let layerIndex = 0; layerIndex < borehole.layers.length; layerIndex++) {
        const layer = borehole.layers[layerIndex];
        const shape = new THREE.Shape();
        cell.forEach(([cx, cz], idx) => {
          if (idx === 0) shape.moveTo(cx, cz);
          else shape.lineTo(cx, cz);
        });

        // CALC THE VOLUMES
        const area = THREE.ShapeUtils.area(shape.getPoints());
        const depth = layer.height / 100;
        const volume = Math.abs(area * depth);
        console.log(`Bohrung ${i+1} - Schicht ${layerIndex+1} (${layer.name}): Fläche = ${area.toFixed(2)} m², Volumen = ${volume.toFixed(2)} m³`);

        if (layer.name) {
            if (!volumes[layer.name]) {
                volumes[layer.name] = { volume: 0, color: layer.color };
            }
            volumes[layer.name].volume += volume;
        }
        // --- END ---

        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: layer.height / 100,
          bevelEnabled: false
        });
        geometry.rotateX(Math.PI / 2); // Rotate to make Y up to become Z up?

        const material = new THREE.MeshStandardMaterial({
          color: layer.color,
          transparent: true,
          opacity: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
        const mesh = new THREE.Mesh(geometry, material);

        // set metadata for raycast info (layerName, thickness, per-cell volume, borehole index, layer index)
        mesh.userData = {
          layerName: layer.name,
          layerThickness: depth,
          layerArea: area,
          layerVolume: volume,
          boreholeIndex: i,
          layerIndex
        };

        mesh.position.set(0, yOffset, 0);
        scene.add(mesh);

        window.ifcMeshes.push(mesh); // Mesh für IFC sammeln

        yOffset -= layer.height / 100;
      }
    }
    updateCharts(cardsData, volumes);
  }
  
  buildModel();
      
  function animate(){
    requestAnimationFrame(animate);
      //controls.update();
      renderer.render(scene, camera);
    }

  function setBoreholeMarkersVisible(visible) {
    if (window.boreholeMarkerGroup) {
      window.boreholeMarkerGroup.visible = visible;
    }
    window.boreholeMarkersVisible = visible;
  }

  window.setBoreholeMarkersVisible = setBoreholeMarkersVisible;
  window.addEventListener('toggleBoreholeMarkers', function(event) {
    setBoreholeMarkersVisible(!!event.detail?.visible);
  });

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
    infoOverlay.style.padding = '0.25rem 0.4rem';
    infoOverlay.style.background = 'rgba(0, 0, 0, 0.55)';
    infoOverlay.style.color = '#fff';
    infoOverlay.style.fontSize = '12px';
    infoOverlay.style.borderRadius = '0';
    infoOverlay.style.pointerEvents = 'none';
    infoOverlay.style.zIndex = 50;
    infoOverlay.style.maxWidth = '240px';
    infoOverlay.innerText = 'Click an object to inspect';
    // ensure container is positioned
    container.style.position = container.style.position || 'relative';
    container.appendChild(infoOverlay);
  }

  // Outline highlight: create a slightly scaled backside clone for halo
  function addHighlight(mesh) {
    if (!mesh) return;
    // If group, add outline to each child mesh
    if (mesh.type === 'Group' || (mesh.children && mesh.children.length > 0 && !mesh.geometry)) {
      mesh.children.forEach(ch => addHighlight(ch));
      return;
    }
    if (mesh.userData._rummz_outline) return;

    // Clone geometry and create a backside material for outline
    const geom = mesh.geometry ? mesh.geometry.clone() : null;
    if (!geom) return;

    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.BackSide });
    const outlineMesh = new THREE.Mesh(geom, outlineMat);
    outlineMesh.name = '_rummz_outline';
    outlineMesh.renderOrder = 9999;

    // Slightly scale outline mesh to produce halo
    outlineMesh.scale.set(1.03, 1.03, 1.03);

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
      if (cur.type === 'Group' && cur.name) return cur;
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
    const intersects = raycaster.intersectObjects(scene.children, true);
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
      const bhData = (bhIndex !== null && cardsData[bhIndex]) ? cardsData[bhIndex] : null;
      const boreholeNumber = (bhIndex !== null) ? (bhIndex + 1) : 'n/a';
      const boreholeTitle = bhData ? (bhData.title || '') : '';

      // Layer info: prefer explicit layerName/thickness/volume from userData
      const layerName = user.layerName || user.layerName || (user.layerIndex !== undefined && bhData ? (bhData.layers[user.layerIndex] && bhData.layers[user.layerIndex].name) : 'n/a');
      const layerThickness = (user.thickness || user.layerThickness) ? (user.thickness || user.layerThickness) : (user.layerIndex !== undefined && bhData ? (bhData.layers[user.layerIndex] && (bhData.layers[user.layerIndex].height/100)) : undefined);
      let layerVolume = user.layerVolume || user.layerVolume;
      let layerArea = user.layerArea || user.layerArea;
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
      infoOverlay.innerText = infoLines.join('\n');
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
        infoOverlay.innerText = 'Click an object to inspect';
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
  }

  // initialize listeners
  setupRayListeners();
  // --- end raycaster section ---


  animate();
  
  };


  // Raycaster für Klick-Interaktion
  /*
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let isDragging = false;
  let mouseDownPos = { x: 0, y: 0 };
  const dragThreshold = 5; // Pixel

  container.addEventListener('mousedown', (event) => {
    isDragging = false;
    mouseDownPos = { x: event.clientX, y: event.clientY };
  });

  container.addEventListener('mousemove', (event) => {
    const dx = event.clientX - mouseDownPos.x;
    const dy = event.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
      isDragging = true;
    }
  });

  container.addEventListener('mouseup', (event) => {
    if (!isDragging) {
      onClick(event); // Nur bei echtem Klick
    }
  });

  function onClick(event) {
    mouse.x = (event.clientX / container.clientWidth) * 2 - 1;
    mouse.y = - (event.clientY / container.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      alert('Y-Position: ' + intersects[0].point.y.toFixed(3));
      console.log("Clicked object:", obj);
    }
  }
  */
  // End Raycaster

  /*
  window.addEventListener('resize', onWindowResize,false);
  function onWindowResize(){
    camera.aspect = container.clientWidth/container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
    */

};

// Export scene -> GLB (binary glTF)
window.exportGeometriesToGLB = function(filenameBase = 'rummz_geometries') {
    if (typeof THREE === 'undefined' || typeof GLTFExporter === 'undefined') {
        throw new Error('three.js oder GLTFExporter nicht geladen.');
    }

    if (typeof window.scene === 'undefined') {
        throw new Error('Keine globale scene gefunden (window.scene).');
    }

    const scene = window.scene;
    const exporter = new GLTFExporter();

    const options = {
        binary: true // erzeugt .glb
    };

    return new Promise((resolve, reject) => {
        try {
            exporter.parse(
                scene,
                function(result) {
                    if (result instanceof ArrayBuffer) {
                        const blob = new Blob([result], { type: 'model/gltf-binary' });
                        const filename = `${filenameBase}.glb`;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        resolve({ filename, blob });
                    } else {
                        // Fallback: text glTF
                        const text = JSON.stringify(result, null, 2);
                        const blob = new Blob([text], { type: 'application/json' });
                        const filename = `${filenameBase}.gltf`;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        resolve({ filename, blob });
                    }
                },
                options
            );
        } catch (err) {
            reject(err);
        }
    });
};

window.addEventListener('updateVisualisation', function(event) {
    const { cardsData } = event.detail;
    updateVisualisation(cardsData);
});

//updateVisualisation (cardsData)