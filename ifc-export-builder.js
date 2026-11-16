const debugLog = () => {};

function decimalDegreesToIfcDMS(decimal) {
    const sign = Math.sign(decimal) >= 0 ? 1 : -1;
    const absValue = Math.abs(decimal);
    let degrees = Math.floor(absValue);
    const minutesFloat = (absValue - degrees) * 60;
    let minutes = Math.floor(minutesFloat);
    let seconds = Number(((minutesFloat - minutes) * 60).toFixed(4));
    if (seconds >= 60) {
        seconds = 0;
        minutes += 1;
    }
    if (minutes >= 60) {
        minutes = 0;
        degrees += 1;
    }
    const signedDegrees = sign * degrees;
    return `(${signedDegrees},${minutes},${seconds})`;
}

function toIfcSafeText(value) {
    const transliterated = String(value ?? '')
        .replace(/\u00c4/g, 'Ae')
        .replace(/\u00d6/g, 'Oe')
        .replace(/\u00dc/g, 'Ue')
        .replace(/\u00e4/g, 'ae')
        .replace(/\u00f6/g, 'oe')
        .replace(/\u00fc/g, 'ue')
        .replace(/\u00df/g, 'ss')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[^\x20-\x7E]/g, '')
        .trim();

    return transliterated.replace(/'/g, "''");
}

function getLayerInfoIfcProperties(info) {
    const properties = [];
    const sections = {
        water: info?.water || {},
        features: info?.features || {},
        description: info?.description || {},
        lab: info?.lab || {}
    };

    const addText = (name, value) => {
        const safeValue = toIfcSafeText(value);
        if (safeValue) properties.push({ name, type: 'IFCTEXT', value: safeValue });
    };
    const addReal = (name, value) => {
        const normalized = String(value ?? '').trim().replace(',', '.');
        if (!normalized) return;
        const number = Number(normalized);
        if (Number.isFinite(number)) properties.push({ name, type: 'IFCREAL', value: number });
    };
    const addActiveText = (section, key, activeKey, name) => {
        if (sections[section][activeKey] === true) addText(name, sections[section][key]);
    };
    const addActiveReal = (section, key, activeKey, name) => {
        if (sections[section][activeKey] === true) addReal(name, sections[section][key]);
    };

    [
        ['groundwaterFrom', 'groundwaterActive', 'Grundwasserstand OK (m)'],
        ['groundwaterTo', 'groundwaterActive', 'Grundwasserstand UK (m)'],
        ['fluctuationFrom', 'fluctuationActive', 'Schwankungsbereich OK (m)'],
        ['fluctuationTo', 'fluctuationActive', 'Schwankungsbereich UK (m)'],
        ['capillaryFrom', 'capillaryActive', 'Kapillarwasserzone OK (m)'],
        ['capillaryTo', 'capillaryActive', 'Kapillarwasserzone UK (m)'],
        ['temporaryFrom', 'temporaryActive', 'Temporaere Wasserzone OK (m)'],
        ['temporaryTo', 'temporaryActive', 'Temporaere Wasserzone UK (m)'],
        ['saturation', 'saturationActive', 'Saettigung Sr (%)'],
        ['porosity', 'porosityActive', 'Poroesitaet n (%)']
    ].forEach(([key, activeKey, name]) => addActiveReal('water', key, activeKey, name));

    addActiveText('features', 'mainSoil', 'mainSoilActive', 'Hauptbodenart');
    addActiveText('features', 'mixedSoil', 'mixedSoilActive', 'Gemischboden');
    addActiveText('features', 'grading', 'gradingActive', 'Abstufung');
    if (sections.features.secondaryActive === true && Array.isArray(sections.features.secondary)) {
        addText('Nebenanteile', sections.features.secondary.map(value => {
            const strength = sections.features.secondaryStrength?.[value];
            return strength ? `${value} (${strength})` : value;
        }).join('; '));
    }
    if (sections.features.organicActive === true && Array.isArray(sections.features.organic)) {
        addText('Organik-Zusaetze', sections.features.organic.map(value => {
            const strength = sections.features.organicStrength?.[value];
            return strength ? `${value} (${strength})` : value;
        }).join('; '));
    }

    [
        ['color', 'colorActive', 'Farbe Beschreibung'],
        ['moisture', 'moistureActive', 'Feuchte'],
        ['consistency', 'consistencyActive', 'Konsistenz'],
        ['density', 'densityActive', 'Lagerung'],
        ['grainSize', 'grainSizeActive', 'Korngroesse'],
        ['plasticity', 'plasticityActive', 'Plastizitaet'],
        ['structure', 'structureActive', 'Struktur'],
        ['fabric', 'fabricActive', 'Gefuege'],
        ['odor', 'odorActive', 'Geruch'],
        ['inclusions', 'inclusionsActive', 'Einschluesse'],
        ['geology', 'geologyActive', 'Geologie']
    ].forEach(([key, activeKey, name]) => addActiveText('description', key, activeKey, name));

    const lab = sections.lab;
    if (lab.isoGroupActive === true) {
        [
            ['isoCoarse', 'isoCoarseActive', 'ISO-Bodengruppe Grobkoernig'],
            ['isoMixed', 'isoMixedActive', 'ISO-Bodengruppe Gemischtkoernig'],
            ['isoFine', 'isoFineActive', 'ISO-Bodengruppe Feinkoernig'],
            ['isoOrganic', 'isoOrganicActive', 'ISO-Bodengruppe Organisch']
        ].forEach(([key, activeKey, name]) => addActiveText('lab', key, activeKey, name));
        if (lab.isoArtificialActive === true) addText('ISO-Bodengruppe Kuenstlich', 'A/FA');
        if (lab.isoRockActive === true) addText('ISO-Bodengruppe Fels', 'FP/R');
    }

    [
        ['sand', 'Sand (%)'],
        ['silt', 'Schluff (%)'],
        ['clay', 'Ton (%)'],
        ['gravel', 'Kies (%)']
    ].forEach(([key, name]) => addActiveReal('lab', key, 'grainSizeDistributionActive', name));

    [
        ['waterContent', 'Wassergehalt w (%)'],
        ['liquidLimit', 'Fliessgrenze wL (%)'],
        ['plasticLimit', 'Ausrollgrenze wP (%)'],
        ['shrinkageLimit', 'Schrumpfgrenze wS (%)'],
        ['plasticityIndex', 'Plastizitaetszahl IP'],
        ['consistencyIndex', 'Konsistenzzahl IC']
    ].forEach(([key, name]) => addActiveReal('lab', key, 'atterbergLimitsActive', name));

    [
        ['plasticityClass', 'plasticityClassActive', 'Plastizitaetsklasse'],
        ['settlement', 'settlementActive', 'Setzungsempfindlichkeit'],
        ['frost', 'frostActive', 'Frostempfindlichkeit'],
        ['compactability', 'compactabilityActive', 'Verdichtbarkeit']
    ].forEach(([key, activeKey, name]) => addActiveText('lab', key, activeKey, name));

    [
        ['organicContent', 'Glueheverlust (%)'],
        ['dryUnitWeight', 'Trockene Wichte (kN/m3)'],
        ['saturatedUnitWeight', 'Gesaettigte Wichte (kN/m3)'],
        ['permeability', 'Durchlaessigkeit kf (m/s)'],
        ['spt', 'Schlagzahl N60'],
        ['grainDensity', 'Korndichte (g/cm3)'],
        ['cohesionEffective', 'Effektive Kohaesion c (kN/m2)'],
        ['cohesionUndrained', 'Undrainierte Kohaesion cu (kN/m2)'],
        ['frictionAngle', 'Reibungswinkel phi (Grad)']
    ].forEach(([key, name]) => addActiveReal('lab', key, 'additionalValuesActive', name));

    return properties;
}

function formatIfcReal(value) {
    const numericValue = String(value);
    const exponentIndex = numericValue.search(/[eE]/);
    if (exponentIndex >= 0) {
        const mantissa = numericValue.slice(0, exponentIndex);
        const exponent = numericValue.slice(exponentIndex + 1);
        return `${mantissa.includes('.') ? mantissa : `${mantissa}.`}E${exponent}`;
    }
    return numericValue.includes('.') ? numericValue : `${numericValue}.`;
}

function generateIFCGUID(idNumber) {
    const idStr = idNumber.toString();
    const paddingNeeded = 22 - idStr.length;
    if (paddingNeeded < 0) {
        throw new Error(`GUID-Wert zu lang: ${idStr.length} Zeichen (max 22)`);
    }
    return '0'.repeat(paddingNeeded) + idStr;
}

export function createIfcDocumentHeader(options = {}) {
    const {
        fileName = 'rummz.ifc',
        timestamp = '2025-01-01T12:00:00',
        author = 'Author',
        organization = 'Organization',
        schema = 'IFC4',
        application = 'RUMMZ-Version-1-Prototyp',
        origin = 'Generated by RUMMZ'
    } = options;

    return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'), '2;1');\nFILE_NAME('${fileName}','${timestamp}',('${author}'),('${organization}'),'${schema}','${application}','${origin}');\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\n`;
}

export function appendIfcDocumentFooter(ifcText) {
    return `${ifcText}ENDSEC;\nEND-ISO-10303-21;\n`;
}

export function buildIfcExport(config) {
    const {
        fullIFC,
        exportContext,
        generateIFCFaceSet,
        generateIFCBoxSet,
        getNextIfcEntityId,
        ifcProjectedCRSDefinitions,
        resolveCoordsToEpsg,
        hexToRgb
    } = config;

    let nextIFC = fullIFC;
    const cardsDataForExport = Array.isArray(exportContext?.cardsData) ? exportContext.cardsData : [];
    const ifcMeshesForExport = Array.isArray(exportContext?.ifcMeshes) ? exportContext.ifcMeshes : [];
    const ifcOrigin = exportContext?.ifcOrigin || { x: 0, y: 0, z: 0 };
    const boxReference = exportContext?.boxReference || null;
    const selectedEpsg = exportContext?.selectedEpsg || '25833';

    const ifcCrs = ifcProjectedCRSDefinitions[selectedEpsg] || ifcProjectedCRSDefinitions['4326'];
    const selectedEpsgZone = ifcCrs.zone === '$' ? '$' : `'${ifcCrs.zone}'`;
    const ifcCrsIdentifier = toIfcSafeText(ifcCrs.identifier);
    const ifcCrsName = toIfcSafeText(ifcCrs.name);
    const ifcCrsDatum = toIfcSafeText(ifcCrs.datum);
    const ifcCrsMethod = toIfcSafeText(ifcCrs.method);

    const refPoint = boxReference && boxReference.coords ? boxReference.coords : null;
    const refLat = refPoint ? refPoint.lat : (boxReference ? boxReference.lat : 51.45);
    const refLon = refPoint ? refPoint.lng : (boxReference ? boxReference.lon : 14.20);
    const refNhn = boxReference ? boxReference.nhn : 50.0;

    const defaultMapConversionX = 454057.331;
    const defaultMapConversionY = 5734617.854;
    let mapConversionX = defaultMapConversionX;
    let mapConversionY = defaultMapConversionY;

    if (refPoint) {
        if (selectedEpsg === '4326') {
            mapConversionX = refLon;
            mapConversionY = refLat;
        } else {
            const projectedOrigin = resolveCoordsToEpsg(refPoint, selectedEpsg);
            if (projectedOrigin && Array.isArray(projectedOrigin)) {
                mapConversionX = projectedOrigin[0];
                mapConversionY = projectedOrigin[1];
            }
        }
    }

    nextIFC += `#1=IFCPROJECT('0000000000000000000001',$,'RUMMZ','Mit diesem Objekt sind die Projektbasisdaten bis inklusive 17 verbunden.',$,$,$,(#2),#9);\n`;
    nextIFC += `#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,#8);\n`;
    nextIFC += `#3=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#2,$,.MODEL_VIEW.,$);\n`;
    nextIFC += `#4=IFCAXIS2PLACEMENT3D(#5,#6,#7);\n`;
    nextIFC += `#5=IFCCARTESIANPOINT((0.,0.,0.));\n`;
    nextIFC += `#6=IFCDIRECTION((0.,0.,1.));\n`;
    nextIFC += `#7=IFCDIRECTION((1.,0.,0.));\n`;
    nextIFC += `#8=IFCDIRECTION((0.0,1.0));\n`;
    nextIFC += `#9=IFCUNITASSIGNMENT((#10,#11,#12));\n`;
    nextIFC += `#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);\n`;
    nextIFC += `#11=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n`;
    nextIFC += `#12=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);\n`;
    nextIFC += `#13=IFCLOCALPLACEMENT($,#4);\n`;
    nextIFC += `#14=IFCPROJECTEDCRS('${ifcCrsIdentifier}','${ifcCrsName}','${ifcCrsDatum}',$,'${ifcCrsMethod}',${selectedEpsgZone},#10);\n`;
    nextIFC += `#15=IFCMAPCONVERSION(#2,#14,${mapConversionX.toFixed(3)},${mapConversionY.toFixed(3)},${refNhn.toFixed(2)},1.,0.,1.);\n`;

    const refLatDMS = decimalDegreesToIfcDMS(refLat);
    const refLonDMS = decimalDegreesToIfcDMS(refLon);

    nextIFC += `#16=IFCSITE('0000000000000000000002',$,'0. Georeferenzierung','Dieses Objekt beinhaltet den Geomarker. Der Geomarker zeigt auf die Georeferenzierung dieser IFC-Datei. Das ist immer der erste Bohrpunkt',$,#13,$,$,.PARTIAL.,${refLatDMS},${refLonDMS},${refNhn.toFixed(2)},$,$);\n`;
    nextIFC += `#17=IFCRELAGGREGATES('0000000000000000000003',$,'Verbindung der Objekte RUMMZ und 0. Georeferenzierung.',$,#1,(#16));\n`;
    nextIFC += `#18=IFCSURFACESTYLE('Geomarker-Gelb',.BOTH.,(#19));\n`;
    nextIFC += `#19=IFCSURFACESTYLESHADING(#20,$);\n`;
    nextIFC += `#20=IFCCOLOURRGB($,1.,1.,0.);\n`;
    nextIFC += `#21=IFCCARTESIANPOINTLIST3D(((1.69990313053131,1.69990313053131,3.37193894386292),(1.90088465869026E-15,7.60353863476105E-15,5.06902589767952E-15),(-1.69990313053131,1.69990313053131,3.37193894386292),(1.69990313053131,-1.69990313053131,3.37193894386292),(-1.69990313053131,-1.69990313053131,3.37193894386292),(-1.69990313053131,-1.69990313053131,6.74387788772583),(1.69990313053131,-1.69990313053131,6.74387788772583),(-1.69990313053131,1.69990313053131,6.74387788772583),(1.69990313053131,1.69990313053131,6.74387788772583)));\n`;
    nextIFC += `#22=IFCINDEXEDPOLYGONALFACE((1,2,3));\n`;
    nextIFC += `#23=IFCINDEXEDPOLYGONALFACE((4,5,2));\n`;
    nextIFC += `#24=IFCINDEXEDPOLYGONALFACE((2,5,3));\n`;
    nextIFC += `#25=IFCINDEXEDPOLYGONALFACE((2,1,4));\n`;
    nextIFC += `#26=IFCINDEXEDPOLYGONALFACE((4,6,5));\n`;
    nextIFC += `#27=IFCINDEXEDPOLYGONALFACE((6,4,7));\n`;
    nextIFC += `#28=IFCINDEXEDPOLYGONALFACE((7,8,6));\n`;
    nextIFC += `#29=IFCINDEXEDPOLYGONALFACE((8,7,9));\n`;
    nextIFC += `#30=IFCINDEXEDPOLYGONALFACE((9,3,8));\n`;
    nextIFC += `#31=IFCINDEXEDPOLYGONALFACE((3,9,1));\n`;
    nextIFC += `#32=IFCINDEXEDPOLYGONALFACE((4,9,7));\n`;
    nextIFC += `#33=IFCINDEXEDPOLYGONALFACE((9,4,1));\n`;
    nextIFC += `#34=IFCINDEXEDPOLYGONALFACE((3,6,8));\n`;
    nextIFC += `#35=IFCINDEXEDPOLYGONALFACE((6,3,5));\n`;
    nextIFC += `#36=IFCPOLYGONALFACESET(#21,$,(#22,#23,#24,#25,#26,#27,#28,#29,#30,#31,#32,#33,#34,#35),$);\n`;
    nextIFC += `#37=IFCSTYLEDITEM(#36,(#18),$);\n`;
    nextIFC += `#38=IFCSHAPEREPRESENTATION(#3,'Body','Tessellation',(#36));\n`;
    nextIFC += `#39=IFCGEOGRAPHICELEMENT('2BqK1DRG16$faoJUdCgEAN',$,'Geomarker','Hier ist die Markierung der Georeferenzierung.','GIS',#13,#41,$,.TERRAIN.);\n`;
    nextIFC += `#40=IFCRELCONTAINEDINSPATIALSTRUCTURE('13VANNJ$rAAAWi5V_ENPge',$,$,$,(#39),#16);\n`;
    nextIFC += `#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#38));\n`;

    const faceMeshes = ifcMeshesForExport.filter(mesh => !mesh.userData?.isCylinder);
    const faceMeshLookup = new Map(faceMeshes
        .filter(mesh => Number.isInteger(mesh.userData?.boreholeIndex) && Number.isInteger(mesh.userData?.layerIndex))
        .map(mesh => [`${mesh.userData.boreholeIndex}-${mesh.userData.layerIndex}`, mesh])
    );

    debugLog('buildIfcExport: start', { selectedEpsg, boreholes: cardsDataForExport.length, faceMeshes: faceMeshes.length });
    const _buildIfc_start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    let _processedBoreholes = 0;

    cardsDataForExport.forEach((borehole, boreholeIndex) => {
        if (boreholeIndex % 5 === 0 || boreholeIndex < 3) debugLog(`buildIfcExport: processing borehole ${boreholeIndex + 1}/${cardsDataForExport.length}`);
        try {
            const siteId = getNextIfcEntityId();
            const relAggId = getNextIfcEntityId();
            const siteName = toIfcSafeText(`${boreholeIndex + 1}. Bohrung`);
            const siteDescription = toIfcSafeText(`Die ${boreholeIndex + 1}. Bohrung beinhaltet das ${boreholeIndex + 1}. Bohrloch mit Bohrpfeilern (gemessene Bohrsaeule) und Schichtvolumen (errechnete Ausdehnung)`);
            const siteRelDescription = toIfcSafeText(`Verbindung der Objekte RUMMZ und ${siteName}`);
            const boreholeCoords = borehole.coords || { lat: 51.45, lng: 14.20 };
            const boreholeLatDMS = decimalDegreesToIfcDMS(boreholeCoords.lat);
            const boreholeLonDMS = decimalDegreesToIfcDMS(boreholeCoords.lng);
            const boreholeNhn = typeof borehole.nhn === 'number' ? borehole.nhn : 0.0;

            nextIFC += `#${siteId}=IFCSITE('${generateIFCGUID(siteId)}',$,'${siteName}','${siteDescription}',$,#13,$,$,.PARTIAL.,${boreholeLatDMS},${boreholeLonDMS},${boreholeNhn.toFixed(2)},$,$);\n`;
            nextIFC += `#${relAggId}=IFCRELAGGREGATES('${generateIFCGUID(relAggId)}',$,'${siteRelDescription}',$,#1,(#${siteId}));\n`;

            borehole.layers.forEach((layer, layerIndex) => {
                const key = `${boreholeIndex}-${layerIndex}`;
                const layerName = toIfcSafeText(layer.name || `Schicht ${layerIndex + 1}`) || `Schicht ${layerIndex + 1}`;
                const color = layer.color || '#000000';
                const rgb = hexToRgb(color);
                const rgbString = rgb ? `${(rgb.r / 255).toFixed(1)},${(rgb.g / 255).toFixed(1)},${(rgb.b / 255).toFixed(1)}` : '0.5,0.5,0.5';
                const layerInfoProperties = getLayerInfoIfcProperties(layer.info);
                const layerInfoRelatedObjectIds = [];

                const styleId = getNextIfcEntityId();
                const shadingId = getNextIfcEntityId();
                const colorId = getNextIfcEntityId();
                nextIFC += `#${styleId}=IFCSURFACESTYLE('${layerName}',.BOTH.,(#${shadingId}));\n`;
                nextIFC += `#${shadingId}=IFCSURFACESTYLESHADING(#${colorId},$);\n`;
                nextIFC += `#${colorId}=IFCCOLOURRGB($,${rgbString});\n`;

                const boxGeometries = generateIFCBoxSet([borehole], boxReference, layerIndex);
                if (boxGeometries.length > 0) {
                    const boxFaceSetId = boxGeometries[0].faceSetId;
                    nextIFC += boxGeometries[0].ifcOutput;
                    const boreholeElementName = toIfcSafeText(`${layerIndex + 1}. Bohrpfeiler`);
                    const boreholePropertySetName = toIfcSafeText(`Eigenschaften des ${boreholeIndex + 1}. Bohrpfeilers`);

                    const shapeRepId = getNextIfcEntityId();
                    const geoElementId = getNextIfcEntityId();
                    const relContainedId = getNextIfcEntityId();
                    const productDefId = getNextIfcEntityId();
                    const styleItemId = getNextIfcEntityId();

                    nextIFC += `#${shapeRepId}=IFCSHAPEREPRESENTATION(#3,'Body','SurfaceModel',(#${boxFaceSetId}));\n`;
                    nextIFC += `#${geoElementId}=IFCGEOGRAPHICELEMENT('${generateIFCGUID(geoElementId)}',$,'${boreholeElementName}','${layerName}','IfcBorehole',#13,#${productDefId},$,.TERRAIN.);\n`;
                    layerInfoRelatedObjectIds.push(geoElementId);
                    nextIFC += `#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateIFCGUID(relContainedId)}',$,$,$,(#${geoElementId}),#${siteId});\n`;
                    nextIFC += `#${productDefId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));\n`;
                    nextIFC += `#${styleItemId}=IFCSTYLEDITEM(#${boxFaceSetId},(#${styleId}),'${layerName}');\n`;

                    const propIds = [];
                    const zTop = borehole.nhn;
                    const zBottom = borehole.nhn - (layer.height / 100);
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Oberkante der gemessenen NHN in Meter',$,IFCREAL(${zTop.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Unterkante der gemessenen NHN in Meter',$,IFCREAL(${zBottom.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Maechtigkeit in cm',$,IFCINTEGER(${layer.height || 0}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Substanz',$,IFCTEXT('${layerName}'),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Farbe als Hex-Wert',$,IFCTEXT('${rgbString}'),$);\n`;

                    const boxArea = 1.0;
                    const boxVolume = boxArea * (layer.height / 100);
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Grundflaeche in m2',$,IFCREAL(${boxArea.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Volumen in m3',$,IFCREAL(${boxVolume.toFixed(2)}),$);\n`;

                    const propSetId = getNextIfcEntityId();
                    nextIFC += `#${propSetId}=IFCPROPERTYSET('${generateIFCGUID(propSetId)}',$,'${boreholePropertySetName}',$,(${propIds.map(id => `#${id}`).join(',')}));\n`;
                    const relPropId = getNextIfcEntityId();
                    nextIFC += `#${relPropId}=IFCRELDEFINESBYPROPERTIES('${generateIFCGUID(relPropId)}',$,$,$,(#${geoElementId}),#${propSetId});\n`;
                }

                const mesh = faceMeshLookup.get(key);
                if (mesh) {
                    const ifcData = generateIFCFaceSet(mesh, ifcOrigin);
                    const faceSetId = ifcData.faceSetId;
                    nextIFC += ifcData.ifcOutput;
                    const layerVolumeElementName = toIfcSafeText(`${layerIndex + 1}. Schichtvolumen`);
                    const layerVolumePropertySetName = toIfcSafeText(`Eigenschaften des ${boreholeIndex + 1}. Schichtvolumens`);

                    const shapeRepId = getNextIfcEntityId();
                    const geoElementId = getNextIfcEntityId();
                    const relContainedId = getNextIfcEntityId();
                    const productDefId = getNextIfcEntityId();
                    const styleItemId = getNextIfcEntityId();

                    nextIFC += `#${shapeRepId}=IFCSHAPEREPRESENTATION(#3,'Body','SurfaceModel',(#${faceSetId}));\n`;
                    nextIFC += `#${geoElementId}=IFCGEOGRAPHICELEMENT('${generateIFCGUID(geoElementId)}',$,'${layerVolumeElementName}','${layerName}','IfcGeotechnicalStratum',#13,#${productDefId},$,.TERRAIN.);\n`;
                    layerInfoRelatedObjectIds.push(geoElementId);
                    nextIFC += `#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateIFCGUID(relContainedId)}',$,$,$,(#${geoElementId}),#${siteId});\n`;
                    nextIFC += `#${productDefId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));\n`;
                    nextIFC += `#${styleItemId}=IFCSTYLEDITEM(#${faceSetId},(#${styleId}),'${layerName}');\n`;

                    const propIds = [];
                    const zTop = borehole.nhn;
                    const zBottom = borehole.nhn - (layer.height / 100);
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Oberkante der gemessenen NHN in Meter',$,IFCREAL(${zTop.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Unterkante der gemessenen NHN in Meter',$,IFCREAL(${zBottom.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Maechtigkeit in cm',$,IFCINTEGER(${layer.height || 0}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Substanz',$,IFCTEXT('${layerName}'),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Farbe als Hex-Wert',$,IFCTEXT('${rgbString}'),$);\n`;

                    const layerArea = mesh.userData?.layerArea || 0;
                    const layerVolume = mesh.userData?.layerVolume || 0;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Grundflaeche in m2',$,IFCREAL(${layerArea.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    nextIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Volumen in m3',$,IFCREAL(${layerVolume.toFixed(2)}),$);\n`;

                    const propSetId = getNextIfcEntityId();
                    nextIFC += `#${propSetId}=IFCPROPERTYSET('${generateIFCGUID(propSetId)}',$,'${layerVolumePropertySetName}',$,(${propIds.map(id => `#${id}`).join(',')}));\n`;
                    const relPropId = getNextIfcEntityId();
                    nextIFC += `#${relPropId}=IFCRELDEFINESBYPROPERTIES('${generateIFCGUID(relPropId)}',$,$,$,(#${geoElementId}),#${propSetId});\n`;
                }

                if (layerInfoProperties.length > 0 && layerInfoRelatedObjectIds.length > 0) {
                    const propertyIds = layerInfoProperties.map(property => {
                        const propertyId = getNextIfcEntityId();
                        const value = property.type === 'IFCREAL'
                            ? `IFCREAL(${formatIfcReal(property.value)})`
                            : `IFCTEXT('${property.value}')`;
                        nextIFC += `#${propertyId}=IFCPROPERTYSINGLEVALUE('${toIfcSafeText(property.name)}',$,${value},$);\n`;
                        return `#${propertyId}`;
                    });
                    const propertySetId = getNextIfcEntityId();
                    const relatedObjects = layerInfoRelatedObjectIds.map(id => `#${id}`).join(',');
                    nextIFC += `#${propertySetId}=IFCPROPERTYSET('${generateIFCGUID(propertySetId)}',$,'Schichtenverzeichnis','Vom Nutzer eingegebene Schichtinformationen',(${propertyIds.join(',')}));\n`;
                    const relPropertyId = getNextIfcEntityId();
                    nextIFC += `#${relPropertyId}=IFCRELDEFINESBYPROPERTIES('${generateIFCGUID(relPropertyId)}',$,$,$,(${relatedObjects}),#${propertySetId});\n`;
                }
            });
            _processedBoreholes++;
        } catch (err) {
            console.error(`buildIfcExport: error processing borehole ${boreholeIndex}`, err);
            throw err;
        }
    });

    const _buildIfc_end = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    debugLog(`buildIfcExport: completed in ${(_buildIfc_end - _buildIfc_start).toFixed(1)} ms, processed ${_processedBoreholes} boreholes, ifc length ${nextIFC.length}`);

    return nextIFC;
}