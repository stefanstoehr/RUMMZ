/**
 * IFC Export Helper Module
 * 
 * Verarbeitet Three.js Geometrien für IFC-Export mit korrekter Georeferenzierung:
 * 1. Extrahiert Eckpunkte aus Three.js-Szene
 * 2. Transformiert Koordinaten vom Three.js-Koordinatensystem in IFC-System
 * 3. Verschiebt Koordinaten relativ zum Ursprungspunkt (erster Bohrpunkt)
 * 4. Generiert IFC-konforme Geometrie-Definitionen
 * 
 * Koordinatentransformation:
 * - Three.js: X (rechts), Y (oben), Z (hinten)
 * - IFC/Voronoi: X (rechts), Y (vorne), Z (oben)
 * - Transformation: [x_three, z_three, -y_three] → [x_ifc, y_ifc, z_ifc]
 */

let nextIfcEntityId = 42;

export function resetIfcEntityId(startId = 42) {
  nextIfcEntityId = startId;
}

export function getNextIfcEntityId() {
  return nextIfcEntityId++;
}

export function analyzeGeometry(mesh) {
  /**
   * Analysiert eine Three.js-Geometrie und zeigt Statistiken
   * für Debugging und Verifikation der Geometrie-Struktur
   */
  const geometry = mesh.geometry;
  const posCount = geometry.attributes.position.count;
  const indexCount = geometry.index ? geometry.index.count : 0;
  
  console.log(`[GEOMETRY ANALYSIS - ${mesh.userData?.layerName || 'Unknown'}]`);
  console.log(`  Position Vertices in array: ${posCount}`);
  console.log(`  Index Count (Faces × 3 für Dreiecke): ${indexCount}`);
  console.log(`  Dreiecke: ${indexCount / 3}`);
  
  const uniqueVertices = new Set();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const key = `${positions.getX(i).toFixed(5)},${positions.getY(i).toFixed(5)},${positions.getZ(i).toFixed(5)}`;
    uniqueVertices.add(key);
  }
  console.log(`  Tatsächlich eindeutige Koordinaten: ${uniqueVertices.size}`);
  console.log(`  Duplikate: ${posCount - uniqueVertices.size} (für Normalen/Texturen)`);
}

function extractVertices(mesh) {
  /**
   * Extrahiert alle Eckpunkte aus der Three.js-Geometrie
   * Rückgabe: Array von [x, y, z] Koordinaten im Three.js-System
   */
  const positionAttribute = mesh.geometry.attributes.position;
  const vertices = [];
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    vertices.push([x, y, z]);
  }
  return vertices;
}

function extractFaces(mesh) {
  /**
   * Extrahiert alle Flächen (Faces) aus der Three.js-Geometrie
   * Rückgabe: Array von [a, b, c] Vertex-Indizes pro Face
   */
  const indexAttribute = mesh.geometry.index;
  const faces = [];
  if (indexAttribute) {
    for (let i = 0; i < indexAttribute.count; i += 3) {
      const a = indexAttribute.getX(i);
      const b = indexAttribute.getX(i + 1);
      const c = indexAttribute.getX(i + 2);
      faces.push([a, b, c]);
    }
  } else {
    console.warn("Keine Indizes gefunden - erstelle Faces aus Vertices");
    const vertexCount = mesh.geometry.attributes.position.count;
    for (let i = 0; i < vertexCount; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }
  }
  return faces;
}

export function generateIFCFaceSet(mesh, origin = { x: 0, y: 0, z: 0 }) {
  /**
   * Generiert eine IFC-konforme Geometrie-Definition aus einer Three.js-Geometrie
   * 
   * Parameter:
   *   mesh: Three.js Mesh mit Geometry
   *   origin: Georeferenz-Ursprungspunkt (typisch: erster Bohrpunkt in Meter-Koordinaten)
   * 
   * Prozess:
   *   1. Extrahiere Eckpunkte und Flächen aus Three.js-Geometrie
   *   2. Transformiere Koordinaten: Three.js (X, Y, Z) → IFC (X, Y, Z)
   *   3. Verschiebe alle Koordinaten relativ zum Origin (Georeferenzierung)
   *   4. Dedupliziere identische Eckpunkte
   *   5. Erstelle IFC PointList und FaceSet Definitionen
   */
  
  const rawVertices = extractVertices(mesh).map(([x, y, z]) => [
    x + mesh.position.x,
    y + mesh.position.y,
    z + mesh.position.z
  ]);
  const rawFaces = extractFaces(mesh);

  // SCHRITT 1: Koordinatentransformation
  // Die Szene ist bereits rotiert (rotateX(PI/2)), um korrekt auszusehen.
  // Für IFC müssen wir die Rotation rückgängig machen, um die IFC-Geometrie korrekt zu orientieren.
  // rotateX(-PI/2) entspricht: [x, -z, y]
  const unrotatedVertices = rawVertices.map(([x, y, z]) => [x, -z, y]);

  // SCHRITT 2 & 3: Verschiebe Vertices relativ zum Ursprungspunkt
  // Der Origin muss in dieselbe IFC-Achsenordnung transformiert werden wie die Eckpunkte.
  const ifcOrigin = {
    x: origin.x,
    y: -origin.z,
    z: origin.y
  };

  const shiftedVertices = unrotatedVertices.map(([x, y, z]) => [
    x - ifcOrigin.x,
    y - ifcOrigin.y,
    z - ifcOrigin.z
  ]);

  // SCHRITT 4: Dedupliziere Eckpunkte (können durch Normalen/Texturen vervielfacht sein)
  const uniqueVertices = [];
  const vertexMap = new Map();
  shiftedVertices.forEach((vertex) => {
    // Nutze fixierte Dezimalstellen als Schlüssel zur Deduplication
    const key = vertex.map(v => v.toFixed(5)).join(',');
    if (!vertexMap.has(key)) {
      vertexMap.set(key, uniqueVertices.length);
      uniqueVertices.push(vertex);
    }
  });

  // Aktualisiere Face-Indizes nach Deduplication
  const faces = rawFaces.map(face => 
    face.map(idx => {
      const key = shiftedVertices[idx].map(v => v.toFixed(5)).join(',');
      return vertexMap.get(key) + 1; // IFC nutzt 1-basierte Indizes
    })
  );

  // SCHRITT 5: Generiere IFC-Ausgabe
  let ifcOutput = '';
  
  // IFCCARTESIANPOINTLIST3D: Alle eindeutigen Eckpunkte
  const pointListId = getNextIfcEntityId();
  ifcOutput += `#${pointListId}=IFCCARTESIANPOINTLIST3D((`;
  ifcOutput += uniqueVertices.map(v => `(${v[0].toFixed(2)},${v[1].toFixed(2)},${v[2].toFixed(2)})`).join(',');
  ifcOutput += `));\n`;

  // IFCINDEXEDPOLYGONALFACE: Alle Flächen, referenzieren Eckpunkte via Indizes
  const faceIds = [];
  faces.forEach(face => {
    const faceId = getNextIfcEntityId();
    ifcOutput += `#${faceId}=IFCINDEXEDPOLYGONALFACE((${face.join(',')}));\n`;
    faceIds.push(`#${faceId}`);
  });

  // IFCPOLYGONALFACESET: Container für alle Flächen (komplette Geometrie)
  const faceSetId = getNextIfcEntityId();
  ifcOutput += `#${faceSetId}=IFCPOLYGONALFACESET(#${pointListId},$,(${faceIds.join(',')}),$);\n`;

  // Logging für Verifikation
  console.log(`[IFC FACESET] Layer: ${mesh.userData?.layerName || 'Unknown'}`);
  console.log(`  Eindeutige Vertices: ${uniqueVertices.length}`);
  console.log(`  Faces/Dreiecke: ${faces.length}`);
  console.log(`  Origin (Georeferenz): (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)})`);
  console.log(ifcOutput);

  return { vertices: uniqueVertices, faces, ifcOutput, faceSetId };
}

// IFC-Quader (ersetzt Zylinder)

export function generateIFCBoxSet(boreholes, referenceBorehole = boreholes[0], layerIndexFilter = null) {
  /**
   * Generiert IFC-Geometrie für Bohrschichten als senkrechte Quader (1x1m Grundfläche)
   * Unabhängig von Three.js-Geometrie, basierend auf Bohrdaten
   *
   * Parameter:
   *   boreholes: Array von Bohrungsobjekten mit:
   *     - lat, lon: Koordinaten in Grad
   *     - nhn: Höhenwert in Metern
   *     - layers: Array von Schichten mit thickness (Mächtigkeit in cm)
   *   referenceBorehole: Optionales Referenz-Bohrloch für gemeinsame x/y/z-Referenz
   *   layerIndexFilter: Optionaler Index der Schicht (0-basiert), um nur diese Schicht zu erzeugen
   *
   * Achsenkonvention:
   *   - x: Ost-West-Abstand zum ersten Bohrpunkt (Meter)
   *   - y: Nord-Süd-Abstand zum ersten Bohrpunkt (Meter)
   *   - z: vertikale Tiefe (negativ, Meter)
   *
   * Erster Bohrpunkt: IFC-Nullpunkt (0,0,0)
   *
   * Rückgabe: Array von IFC-Geometrien, eine pro Schicht pro Bohrung (oder gefiltert)
   */

  if (!boreholes || boreholes.length === 0) {
    console.warn('[IFC BOX SET] Keine Bohrdaten vorhanden');
    return [];
  }

  const refLat = referenceBorehole.coords ? referenceBorehole.coords.lat : referenceBorehole.lat;
  const refLon = referenceBorehole.coords ? referenceBorehole.coords.lng : referenceBorehole.lon;
  const refNhn = referenceBorehole.nhn;

  // Einfache Umrechnung Grad zu Meter (angenähert)
  // 1° lat ≈ 111320m, 1° lon ≈ 111320m * cos(lat)
  const degToMeterLat = 111320;
  const degToMeterLon = 111320 * Math.cos(refLat * Math.PI / 180);

  const ifcGeometries = [];

  boreholes.forEach((borehole, boreholeIndex) => {
    // Relative Position zum ersten Bohrpunkt berechnen
    const bhLat = borehole.coords ? borehole.coords.lat : borehole.lat;
    const bhLon = borehole.coords ? borehole.coords.lng : borehole.lon;
    const deltaLat = bhLat - refLat;
    const deltaLon = bhLon - refLon;
    const deltaNhn = borehole.nhn - refNhn;

    const xOffset = deltaLon * degToMeterLon; // Ost-West
    const yOffset = deltaLat * degToMeterLat; // Nord-Süd
    const zStart = deltaNhn; // Vertikaler Offset

    let currentDepth = zStart; // Starttiefe für diese Bohrung
    if (layerIndexFilter !== null) {
      const filterIndex = Number(layerIndexFilter);
      if (filterIndex > 0 && Array.isArray(borehole.layers)) {
        const depthOffset = borehole.layers
          .slice(0, filterIndex)
          .reduce((sum, prevLayer) => sum + ((prevLayer.height || prevLayer.thickness) / 100), 0);
        currentDepth -= depthOffset;
      }
    }

    const layersToProcess = layerIndexFilter !== null ? [borehole.layers[layerIndexFilter]] : borehole.layers;
    const layerIndices = layerIndexFilter !== null ? [layerIndexFilter] : borehole.layers.map((_, idx) => idx);

    layersToProcess.forEach((layer, localIndex) => {
      const layerIndex = layerIndices[localIndex];
      const thickness = (layer.height || layer.thickness) / 100; // cm zu m
      const zBottom = currentDepth - thickness; // Quader geht nach unten

      // Quader-Eckpunkte definieren (1x1m Grundfläche)
      // Ursprung: (xOffset, yOffset, currentDepth) - oben links vorne
      const boxVertices = [
        [xOffset - 0.5, yOffset - 0.5, currentDepth],     // 0: oben links vorne
        [xOffset + 0.5, yOffset - 0.5, currentDepth],     // 1: oben rechts vorne
        [xOffset + 0.5, yOffset + 0.5, currentDepth],     // 2: oben rechts hinten
        [xOffset - 0.5, yOffset + 0.5, currentDepth],     // 3: oben links hinten
        [xOffset - 0.5, yOffset - 0.5, zBottom],          // 4: unten links vorne
        [xOffset + 0.5, yOffset - 0.5, zBottom],          // 5: unten rechts vorne
        [xOffset + 0.5, yOffset + 0.5, zBottom],          // 6: unten rechts hinten
        [xOffset - 0.5, yOffset + 0.5, zBottom]           // 7: unten links hinten
      ];

      // Faces definieren (6 Seiten des Quaders)
      const boxFaces = [
        [0, 1, 2, 3], // oben
        [4, 5, 6, 7], // unten
        [0, 1, 5, 4], // vorne
        [1, 2, 6, 5], // rechts
        [2, 3, 7, 6], // hinten
        [3, 0, 4, 7]  // links
      ];

      // IFC-Ausgabe für diese einzelne Schicht generieren
      let ifcOutput = '';

      // IFCCARTESIANPOINTLIST3D: Alle Eckpunkte dieser Schicht
      const pointListId = getNextIfcEntityId();
      ifcOutput += `#${pointListId}=IFCCARTESIANPOINTLIST3D((`;
      ifcOutput += boxVertices.map(v => `(${v[0].toFixed(2)},${v[1].toFixed(2)},${v[2].toFixed(2)})`).join(',');
      ifcOutput += `));\n`;

      // IFCINDEXEDPOLYGONALFACE: Alle Flächen dieser Schicht
      const faceIds = [];
      boxFaces.forEach(face => {
        const faceId = getNextIfcEntityId();
        ifcOutput += `#${faceId}=IFCINDEXEDPOLYGONALFACE((${face.map(idx => idx + 1).join(',')}));\n`;
        faceIds.push(`#${faceId}`);
      });

      // IFCPOLYGONALFACESET: Container für diese Schicht
      const faceSetId = getNextIfcEntityId();
      ifcOutput += `#${faceSetId}=IFCPOLYGONALFACESET(#${pointListId},$,(${faceIds.join(',')}),$);\n`;

      ifcGeometries.push({
        vertices: boxVertices,
        faces: boxFaces,
        ifcOutput,
        faceSetId,
        boreholeIndex,
        layerIndex,
        layerName: layer.name
      });

      currentDepth = zBottom; // Für nächste Schicht tiefer gehen
    });
  });

  console.log(`[IFC BOX SET] Bohrungen: ${boreholes.length}, Einzelgeometrien: ${ifcGeometries.length}`);
  console.log(`  Referenzpunkt: (${refLat.toFixed(6)}, ${refLon.toFixed(6)}, ${refNhn.toFixed(2)})`);

  return ifcGeometries;
}
