// HELPER: Export project data as JSON
function getProjectDownloadName() {
    const rawTitle = typeof projectTitle === 'string' ? projectTitle.trim() : '';
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, '_');
    return safeTitle || 'rummz_project';
}

const supportedEpsgCodes = Array.isArray(supportedEPSGs)
    ? new Set(supportedEPSGs.map(epsg => epsg.code))
    : new Set(['4326']);

function exportProjectAsJSON() {
    const exportData = {
        title: projectTitle,
        boreholes: cardsData
    };
    const jsonText = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getProjectDownloadName()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function normalizeImportedCoords(coords) {
    if (!coords) return null;

    const latValue = Array.isArray(coords) ? coords[0] : coords.lat;
    const lngValue = Array.isArray(coords) ? coords[1] : coords.lng;
    const lat = Number(latValue);
    const lng = Number(lngValue);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
}

function normalizeImportedLayer(cardId, layer, layerIndex) {
    const fallbackLayer = createNewLayer(cardId, layerIndex + 1);
    const parsedHeight = typeof layer?.height === 'string'
        ? Number(layer.height.trim().replace(',', '.'))
        : Number(layer?.height);

    return {
        ...fallbackLayer,
        id: typeof layer?.id === 'string' && layer.id.trim() ? layer.id : fallbackLayer.id,
        name: typeof layer?.name === 'string' ? layer.name : '',
        height: Number.isFinite(parsedHeight) ? parsedHeight : null,
        color: typeof layer?.color === 'string' && layer.color.trim() ? layer.color : fallbackLayer.color
    };
}

function normalizeImportedCard(card, index) {
    const requestedEpsg = typeof card?.epsg === 'string' ? card.epsg : '4326';
    const normalizedEpsg = supportedEpsgCodes.has(requestedEpsg) ? requestedEpsg : '4326';
    const fallbackCard = createNewCard(index, null, normalizedEpsg);
    const normalizedCardId = typeof card?.id === 'string' && card.id.trim() ? card.id : fallbackCard.id;
    const parsedNhn = typeof card?.nhn === 'string'
        ? Number(card.nhn.trim().replace(',', '.'))
        : Number(card?.nhn);
    const rawLayers = Array.isArray(card?.layers) && card.layers.length > 0 ? card.layers : [null];

    return {
        ...fallbackCard,
        id: normalizedCardId,
        title: typeof card?.title === 'string' ? card.title : '',
        coords: normalizeImportedCoords(card?.coords),
        epsg: normalizedEpsg,
        nhn: Number.isFinite(parsedNhn) ? parsedNhn : null,
        layers: rawLayers.map((layer, layerIndex) => normalizeImportedLayer(normalizedCardId, layer, layerIndex))
    };
}

function normalizeImportedProject(importedData) {
    if (Array.isArray(importedData)) {
        return {
            title: '',
            boreholes: importedData.map((card, index) => normalizeImportedCard(card, index))
        };
    }

    if (Array.isArray(importedData?.boreholes)) {
        return {
            title: typeof importedData.title === 'string' ? importedData.title : '',
            boreholes: importedData.boreholes.map((card, index) => normalizeImportedCard(card, index))
        };
    }

    throw new Error('The file should contain either an array of cards or an object with { title, boreholes }.');
}

function resetImportedProjectState() {
    Object.values(mapInstances).forEach(map => {
        if (map && typeof map.remove === 'function') {
            map.remove();
        }
    });
    mapInstances = {};

    if (typeof markerInstances !== 'undefined') {
        markerInstances = {};
    }
    if (typeof mapMarkerInstances !== 'undefined') {
        mapMarkerInstances = {};
    }
}

function importProjectFromJSON(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        showWaitOverlay();
        // Defer the heavy rebuild so the browser can paint the overlay first.
        setTimeout(() => {
            try {
                const importedData = JSON.parse(event.target.result);
                const normalizedProject = normalizeImportedProject(importedData);

                projectTitle = normalizedProject.title;
                cardsData = normalizedProject.boreholes;

                resetImportedProjectState();
                initialRender();
                triggerVisualisationUpdate();
            } catch (error) {
                alert('Error parsing JSON file: ' + error.message);
            } finally {
                hideWaitOverlay();
            }
        }, 20);
    };
    reader.readAsText(file);
}

// DOWNLOAD DATASET
const jsonDownloadButton = document.getElementById('json-download');
if (jsonDownloadButton) {
    jsonDownloadButton.addEventListener('click', event => {
        event.preventDefault();
        exportProjectAsJSON();
    });
}

// UPLOAD DATASET
const jsonUploadButton = document.getElementById('json-upload');
if (jsonUploadButton) {
    jsonUploadButton.addEventListener('click', event => {
        event.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = changeEvent => {
            const file = changeEvent.target.files?.[0];
            importProjectFromJSON(file);
        };
        input.click();
    });
}
