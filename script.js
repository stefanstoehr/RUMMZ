/**
 * RUMMZ Application - Main Script
 * 
 * Core Functionality:
 * - Manages borehole data model and UI state
 * - Handles card/layer creation, editing, and deletion
 * - Manages Leaflet maps for coordinate selection
 * - Triggers 3D visualization updates
 * - Exports/imports project data as JSON
 * 
 * Global State:
 * - cardsData: Array of borehole objects
 * - mapInstances: Map of Leaflet instances keyed by card ID
 * - projectTitle: User-defined project name
 * - lastSelectedEPSG / dashboardSelectedEPSG: Coordinate system selections
 */

// DATA MODEL & CONSTANTS

let cardsData = [];
let mapInstances = {};
let markerInstances = {};
const gridContent = document.querySelector('.grid-content');
let projectTitle = '';
let lastSelectedEPSG = '4326';
let dashboardSelectedEPSG = lastSelectedEPSG;
const layerNameSuggestions = [
    'Auffüllung',
    'Feinkies',
    'Feinsand',
    'Fels',
    'Geschiebelehm',
    'Geschiebemergel',
    'Grobkies',
    'Grobsand',
    'Kies',
    'Klei',
    'Löss',
    'Mittelkies',
    'Mittelsand',
    'Mudde',
    'Mutterboden',
    'Sand',
    'Schluff',
    'Steine',
    'Ton',
    'Torf/Humos',
    'Wiesenkalk'
];

const layerNameAutoColorMap = {
    'auffullung': '#ffffff',
    'feinkies': '#fff3a6',
    'feinsand': '#ffcc99',
    'fels': '#20c991',
    'geschiebelehm': '#8b8b8b',
    'geschiebemergel': '#4e79a7',
    'grobkies': '#e0b100',
    'grobsand': '#cc7000',
    'kies': '#fffde7',
    'klei': '#9c27b0',
    'loss': '#6b8e23',
    'mittelkies': '#fff200',
    'mittelsand': '#ff8000',
    'mudde': '#ff9ad5',
    'mutterboden': '#b98b6b',
    'sand': '#ffd2a6',
    'schluff': '#6b8e23',
    'steine': '#b58900',
    'ton': '#7a5cff',
    'torf/humos': '#6b4f3a',
    'wiesenkalk': '#00e1ff'
};

// Set footer year dynamically
try {
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
} catch (e) {
    // Silently ignore - may run in non-browser context
}

// === LOADING OVERLAY ===
// Hide loading overlay after page load
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        // Simulate connection check (2 seconds)
        setTimeout(() => {
            overlay.classList.add('fade-out');
            // Remove from DOM after animation completes
            setTimeout(() => {
                overlay.remove();
            }, 500);
        }, 2000);
    }
}

// Trigger when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLoadingOverlay);
} else {
    // Page already loaded
    hideLoadingOverlay();
}

// === DATA HELPER FUNCTIONS ===

function createNewLayer(cardId, layerNum) {
    return {
        id: `${cardId}-layer-${layerNum}-${Date.now()}`,
        name: '',
        height: null, // Stored in cm
        color: '#dee2e6' // Default color
    };
}

function createNewCard(index, initialView = null, epsg = null) {
    const cardId = `card-${Date.now()}-${index}`;
    const useEpsg = epsg || lastSelectedEPSG || '4326';
    return {
        id: cardId,
        title: '',
        coords: null,
        epsg: useEpsg,
        nhn: null, // Stored in m
        layers: [createNewLayer(cardId, 1)],
        initialView: initialView
    };
}

const supportedEPSGs = [
    { code: '4326', label: 'WGS 84 (EPSG:4326)' },
    { code: '3857', label: 'Web Mercator (EPSG:3857)' },
    { code: '25832', label: 'ETRS89 / UTM zone 32N (EPSG:25832)' },
    { code: '25833', label: 'ETRS89 / UTM zone 33N (EPSG:25833)' },
    { code: '32633', label: 'WGS 84 / UTM zone 33N (EPSG:32633)' }
];

const ifcProjectedCRSDefinitions = {
    '4326': {
        identifier: 'EPSG:4326',
        name: 'WGS 84 / Geographic',
        datum: 'WGS 84',
        method: 'GEOGRAPHIC',
        zone: '$'
    },
    '3857': {
        identifier: 'EPSG:3857',
        name: 'WGS 84 / Pseudo-Mercator',
        datum: 'WGS 84',
        method: 'POPULAR_VISUALISATION_PSEUDO_MERCATOR',
        zone: '$'
    },
    '25832': {
        identifier: 'EPSG:25832',
        name: 'ETRS89 / UTM zone 32N',
        datum: 'ETRS89',
        method: 'UTM',
        zone: '32N'
    },
    '25833': {
        identifier: 'EPSG:25833',
        name: 'ETRS89 / UTM zone 33N',
        datum: 'ETRS89',
        method: 'UTM',
        zone: '33N'
    },
    '32633': {
        identifier: 'EPSG:32633',
        name: 'WGS 84 / UTM zone 33N',
        datum: 'WGS 84',
        method: 'UTM',
        zone: '33N'
    }
};

function ensureProj4Defs() {
    if (typeof proj4 === 'undefined') return;
    if (!proj4.defs('EPSG:3857')) {
        proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +no_defs');
    }
    if (!proj4.defs('EPSG:25832')) {
        proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
    }
    if (!proj4.defs('EPSG:25833')) {
        proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');
    }
    if (!proj4.defs('EPSG:32633')) {
        proj4.defs('EPSG:32633', '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');
    }
}

function getEpsgSelectOptions(selectedCode = '4326') {
    return supportedEPSGs.map(epsg => `    <option value="${epsg.code}" ${epsg.code === selectedCode ? 'selected' : ''}>${epsg.code}</option>`).join('\n');
}

function getSelectedEpsg(cardId) {
    const epsgSelect = document.getElementById(`epsg-${cardId}`);
    return epsgSelect ? epsgSelect.value : '4326';
}

function resolveCoordsToEpsg(coords, epsgCode) {
    if (!coords) return null;
    if (epsgCode === '4326' || typeof proj4 === 'undefined') {
        return [coords.lat, coords.lng];
    }
    try {
        const result = proj4('EPSG:4326', `EPSG:${epsgCode}`, [coords.lng, coords.lat]);
        return result;
    } catch (error) {
        console.warn('proj4 conversion failed for EPSG:' + epsgCode, error);
        return [coords.lat, coords.lng];
    }
}

function resolveEpsgToCoords(first, second, epsgCode) {
    if (epsgCode === '4326' || typeof proj4 === 'undefined') {
        return { lat: first, lng: second };
    }
    try {
        const result = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [first, second]);
        if (!result || !Array.isArray(result)) return null;
        return { lat: result[1], lng: result[0] };
    } catch (error) {
        console.warn('proj4 reverse conversion failed for EPSG:' + epsgCode, error);
        return null;
    }
}

function parseCoordinateInputValue(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const normalized = rawValue.trim().replace(',', '.');
    if (normalized === '') return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

function clearCoordsInputError(cardId) {
    const latInput = document.getElementById(`lat-${cardId}`);
    const lngInput = document.getElementById(`lng-${cardId}`);
    if (!latInput || !lngInput) return;
    latInput.classList.remove('coord-input-invalid');
    lngInput.classList.remove('coord-input-invalid');
    latInput.title = '';
    lngInput.title = '';
}

function setCoordsInputError(cardId, message) {
    const latInput = document.getElementById(`lat-${cardId}`);
    const lngInput = document.getElementById(`lng-${cardId}`);
    if (!latInput || !lngInput) return;
    latInput.classList.add('coord-input-invalid');
    lngInput.classList.add('coord-input-invalid');
    latInput.title = message;
    lngInput.title = message;
}

function syncCardMarker(card, options = {}) {
    const map = mapInstances[card.id];
    if (!map || !card.coords || map.dataset?.mapError === 'true' || typeof L === 'undefined') return;

    let marker = markerInstances[card.id];
    if (!marker) {
        marker = L.marker(card.coords, { draggable: true }).addTo(map);
        marker.on('drag', function(e) {
            const newCoords = e.target.getLatLng();
            card.coords = newCoords;
            clearCoordsInputError(card.id);
            updateCoordsInputs(card.id, newCoords);
        });
        marker.on('dragend', function() {
            triggerVisualisationUpdate();
        });
        markerInstances[card.id] = marker;
    } else {
        marker.setLatLng(card.coords);
    }

    if (options.centerMap === true) {
        map.setView(card.coords, map.getZoom());
    }
}

function clearCardCoords(card) {
    card.coords = null;
    const marker = markerInstances[card.id];
    if (marker && mapInstances[card.id]) {
        mapInstances[card.id].removeLayer(marker);
    }
    delete markerInstances[card.id];
    clearCoordsInputError(card.id);
    updateCoordsInputs(card.id, null);
}

function commitCoordinateInputs(cardId) {
    const card = cardsData.find(c => c.id === cardId);
    if (!card) return;

    const latInput = document.getElementById(`lat-${cardId}`);
    const lngInput = document.getElementById(`lng-${cardId}`);
    if (!latInput || !lngInput) return;

    const latRaw = latInput.value.trim();
    const lngRaw = lngInput.value.trim();

    if (latRaw === '' && lngRaw === '') {
        clearCardCoords(card);
        triggerVisualisationUpdate();
        return;
    }

    if (latRaw === '' || lngRaw === '') {
        setCoordsInputError(cardId, 'Bitte beide Koordinatenwerte eingeben.');
        return;
    }

    const first = parseCoordinateInputValue(latRaw);
    const second = parseCoordinateInputValue(lngRaw);
    if (first === null || second === null) {
        setCoordsInputError(cardId, 'Ungueltiges Zahlenformat. Beispiel: 51.12345 oder 51,12345');
        return;
    }

    const epsgCode = getSelectedEpsg(cardId);
    const wgsCoords = resolveEpsgToCoords(first, second, epsgCode);
    if (!wgsCoords || !Number.isFinite(wgsCoords.lat) || !Number.isFinite(wgsCoords.lng)) {
        setCoordsInputError(cardId, 'Koordinaten konnten nicht umgerechnet werden.');
        return;
    }

    if (wgsCoords.lat < -90 || wgsCoords.lat > 90 || wgsCoords.lng < -180 || wgsCoords.lng > 180) {
        setCoordsInputError(cardId, 'Koordinaten ausserhalb gueltigem Bereich.');
        return;
    }

    clearCoordsInputError(cardId);
    card.coords = wgsCoords;
    syncCardMarker(card, { centerMap: true });
    updateCoordsInputs(cardId, wgsCoords);
    triggerVisualisationUpdate();
}

function updateCoordsLabel(cardId, epsgCode) {
    const latLabel = document.querySelector(`#${cardId} .lat-label`);
    const lngLabel = document.querySelector(`#${cardId} .lng-label`);
    if (!latLabel || !lngLabel) return;

    const latTextElem = latLabel.querySelector('.coord-label-text');
    const lngTextElem = lngLabel.querySelector('.coord-label-text');

    if (epsgCode === '4326') {
        if (latTextElem) latTextElem.textContent = 'Latitude';
        if (lngTextElem) lngTextElem.textContent = 'Longitude';
    } else {
        if (latTextElem) latTextElem.textContent = 'Easting';
        if (lngTextElem) lngTextElem.textContent = 'Northing';
    }

    updateCoordTooltipText(cardId, epsgCode);
}

function getCoordTooltipText(epsgCode, field) {
    if (epsgCode === '4326') {
        if (field === 'first') {
            return 'Latitude in Dezimalgrad. Gueltiger Bereich: -90 bis 90. Beispiel: 51.23456';
        }
        return 'Longitude in Dezimalgrad. Gueltiger Bereich: -180 bis 180. Beispiel: 7.12345';
    }

    if (field === 'first') {
        return `Easting in EPSG:${epsgCode} (Meter). Beispiel: 392000`;
    }
    return `Northing in EPSG:${epsgCode} (Meter). Beispiel: 5704000`;
}

function updateCoordTooltipText(cardId, epsgCode) {
    const firstTooltip = document.getElementById(`coord-tooltip-first-${cardId}`);
    const secondTooltip = document.getElementById(`coord-tooltip-second-${cardId}`);
    const firstBtn = document.querySelector(`#${cardId} .coord-info-btn[data-coord-kind="first"]`);
    const secondBtn = document.querySelector(`#${cardId} .coord-info-btn[data-coord-kind="second"]`);

    const firstText = getCoordTooltipText(epsgCode, 'first');
    const secondText = getCoordTooltipText(epsgCode, 'second');

    const firstTextElem = firstTooltip?.querySelector('.coord-tooltip-text');
    const secondTextElem = secondTooltip?.querySelector('.coord-tooltip-text');
    if (firstTextElem) firstTextElem.textContent = firstText;
    if (secondTextElem) secondTextElem.textContent = secondText;
    if (firstBtn) firstBtn.removeAttribute('title');
    if (secondBtn) secondBtn.removeAttribute('title');
}

function hideCoordTooltips(exceptTooltipId = null) {
    const tooltips = document.querySelectorAll('.coord-tooltip.is-visible');
    tooltips.forEach((tooltip) => {
        if (exceptTooltipId && tooltip.id === exceptTooltipId) return;
        tooltip.classList.remove('is-visible');
    });
}

function toggleCoordTooltip(cardId, coordKind) {
    const tooltipId = `coord-tooltip-${coordKind}-${cardId}`;
    const tooltip = document.getElementById(tooltipId);
    if (!tooltip) return;

    tooltip.classList.remove('coord-tooltip-dismissed');
    const shouldShow = !tooltip.classList.contains('is-visible');
    hideCoordTooltips(shouldShow ? tooltipId : null);
    tooltip.classList.toggle('is-visible', shouldShow);
}

// Hilfsfunktion für Hex zu RGB Konvertierung
// === UTILITY FUNCTIONS ===

/**
 * Converts hexadecimal color to RGB object
 * @param {string} hex - Hex color code (e.g., '#ff0000')
 * @returns {object|null} RGB object {r, g, b} or null if invalid
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 * Triggers 3D visualization update event
 * Sends current cardsData to visualization listeners
 */
function triggerVisualisationUpdate() {
    window.dispatchEvent(new CustomEvent('updateVisualisation', { detail: { cardsData: cardsData } }));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeLayerNameValue(value) {
    return String(value || '')
        .toLocaleLowerCase('de-DE')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function getFilteredLayerNameSuggestions(query) {
    const normalizedQuery = normalizeLayerNameValue(query).trim();
    if (!normalizedQuery) return layerNameSuggestions;

    const startsWithMatches = layerNameSuggestions.filter((name) => {
        return normalizeLayerNameValue(name).startsWith(normalizedQuery);
    });

    const containsMatches = layerNameSuggestions.filter((name) => {
        const normalizedName = normalizeLayerNameValue(name);
        return !normalizedName.startsWith(normalizedQuery) && normalizedName.includes(normalizedQuery);
    });

    return [...startsWithMatches, ...containsMatches];
}

function getLayerNameOptionButtonsMarkup(query) {
    const suggestions = getFilteredLayerNameSuggestions(query);
    if (!suggestions.length) {
        return '<div class="layername-option-empty">Kein passender Vorschlag</div>';
    }

    return suggestions.map((name) => {
        const escaped = escapeHtml(name);
        return `<button type="button" class="layername-option" data-value="${escaped}">${escaped}</button>`;
    }).join('');
}

function updateLayerNameMenuForInput(input) {
    const group = input.closest('.layername-input-group');
    if (!group) return;
    const list = group.querySelector('.layername-menu-list');
    if (!list) return;
    list.innerHTML = getLayerNameOptionButtonsMarkup(input.value || '');
}

function getLayerNameOptions(group) {
    if (!group) return [];
    return Array.from(group.querySelectorAll('.layername-option'));
}

function setActiveLayerNameOption(group, nextIndex, shouldScroll = true) {
    const options = getLayerNameOptions(group);
    if (!options.length) return -1;

    const safeIndex = Math.max(0, Math.min(nextIndex, options.length - 1));
    options.forEach((option, index) => {
        const isActive = index === safeIndex;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-selected', String(isActive));
        if (isActive && shouldScroll) {
            option.scrollIntoView({ block: 'nearest' });
        }
    });

    return safeIndex;
}

function getActiveLayerNameOptionIndex(group) {
    const options = getLayerNameOptions(group);
    return options.findIndex((option) => option.classList.contains('is-active'));
}

function hideLayerNameMenu(group) {
    const menu = group?.querySelector('.layername-menu');
    if (!menu) return;
    menu.hidden = true;
    group.classList.remove('layername-menu-open');
}

function hideAllLayerNameMenus(exceptGroup = null) {
    document.querySelectorAll('.layername-input-group').forEach((group) => {
        if (exceptGroup && group === exceptGroup) return;
        hideLayerNameMenu(group);
    });
}

function showLayerNameMenuForInput(input) {
    const group = input.closest('.layername-input-group');
    if (!group) return;

    hideAllLayerNameMenus(group);
    updateLayerNameMenuForInput(input);

    const menu = group.querySelector('.layername-menu');
    if (!menu) return;
    menu.hidden = false;
    group.classList.add('layername-menu-open');
    setActiveLayerNameOption(group, 0, false);
}

function applyLayerNameInputValue(input, value) {
    input.value = value;

    const cardId = input.dataset.cardId;
    const layerId = input.dataset.layerId;
    const card = cardsData.find(c => c.id === cardId);
    const layer = card?.layers.find(l => l.id === layerId);
    if (layer) {
        layer.name = value;
        applyAutoColorForLayer(card.id, layer);
        triggerVisualisationUpdate();
    }
}

function getAutoColorForLayerName(layerName) {
    const normalized = normalizeLayerNameValue(layerName).trim();
    if (!normalized) return null;
    return layerNameAutoColorMap[normalized] || null;
}

function applyAutoColorForLayer(cardId, layer) {
    if (!cardId || !layer) return;
    const autoColor = getAutoColorForLayerName(layer.name);
    if (!autoColor) return;

    layer.color = autoColor;

    const colorInput = document.querySelector(`.layer-color-picker[data-card-id="${cardId}"][data-layer-id="${layer.id}"]`);
    if (colorInput) {
        colorInput.value = autoColor;
    }

    const layerElement = document.getElementById(layer.id);
    if (layerElement) {
        layerElement.style.borderLeftColor = autoColor;
    }
}

// === LAYER RENDER/UPDATE FUNCTIONS ===

/**
 * Renders all layers for a given card into its container
 * @param {object} card - Card data object
 * @param {HTMLElement} container - Target container for layer elements
 */
function renderLayers(card, container) {
    container.innerHTML = ''; // Clear the container
    const fragment = document.createDocumentFragment();
    const totalLayers = card.layers.length;

    card.layers.forEach((layer, layerIndex) => {
        const layerDiv = document.createElement('div');
        layerDiv.className = 'card-layer';
        layerDiv.id = layer.id;
        layerDiv.style.borderLeftColor = layer.color;
        const heightInCm = (typeof layer.height === 'number') ? layer.height : '';
        const baseNhn = (typeof card.nhn === 'number') ? card.nhn : 0;
        const layerHeightM = (typeof layer.height === 'number') ? (layer.height / 100) : 0;
        const topDepthM = card.layers
            .slice(0, layerIndex)
            .reduce((sum, currentLayer) => sum + (((typeof currentLayer.height === 'number') ? currentLayer.height : 0) / 100), 0);
        const bottomDepthM = topDepthM + layerHeightM;
        const bottomNhnText = `${(baseNhn - bottomDepthM).toFixed(2)} m`;
        const bottomDepthText = `${bottomDepthM.toFixed(2)} m`;
        const boundaryText = `NHN: ${bottomNhnText} | Tiefe: ${bottomDepthText}`;
        const predefinedColors = [
            { name: 'Rot', value: '#ff0004' },
            { name: 'Orange', value: '#ff8000' },
            { name: 'Gelb', value: '#fff200' },
            { name: 'Magenta/Pink', value: '#ff00aa' },
            { name: 'Violett/Lila', value: '#7a5cff' },
            { name: 'Blau', value: '#007bff' },
            { name: 'Blaugrau', value: '#4e79a7' },
            { name: 'Cyan/Hellblau', value: '#00e1ff' },
            { name: 'Türkis', value: '#20c991' },
            { name: 'Hellgrün', value: '#1eff00' },
            { name: 'Grün', value: '#0c6700' },
            { name: 'Oliv', value: '#6b8e23' },
            { name: 'Braun', value: '#8d6e63' },
            { name: 'Gelbbraun', value: '#b8810b' },
            { name: 'Schwarz', value: '#000000' },
            { name: 'Grau', value: '#8b8b8b' },
            { name: 'Weiß', value: '#ffffff' }
        ];

        layerDiv.innerHTML = `
            <div class="layer-header">
                <div class="layer-title-block">
                    <strong>Schicht ${layerIndex + 1} <span class="card-title-total">von ${totalLayers}</span></strong>
                    <div class="color-picker-group">
                        <div class="color-swatch-row" role="list" aria-label="Vordefinierte Farben">
                            ${predefinedColors.map(({ name, value }) => `
                                <button type="button" class="color-swatch" data-card-id="${card.id}" data-layer-id="${layer.id}" data-color="${value}" style="background-color:${value}" title="${name}" aria-label="Farbe ${name}"></button>
                            `).join('')}
                        </div>
                        <input type="color" class="layer-color-picker" 
                               data-card-id="${card.id}" data-layer-id="${layer.id}" value="${layer.color}" aria-label="Schichtfarbe wählen">
                    </div>
                </div>
                <button class="delete-layer-btn ${card.layers.length <= 1 ? 'invisible' : ''}" aria-label="Schicht löschen" data-card-id="${card.id}" data-layer-id="${layer.id}">×</button>
            </div>
            <div class="layer-inputs">
                <div class="location-input-group layername-input-group">
                    <label class="coord-label-wrap coord-label-wrap-full" for="layername-${layer.id}">
                        <span class="required-label-prefix"><span class="required-marker" aria-hidden="true">*</span><span class="coord-label-text">Name</span></span>
                        <button type="button" class="coord-info-btn" data-card-id="${layer.id}" data-coord-kind="layername" aria-label="Info zu Schichtname">
                            <i class="bi bi-question-circle"></i>
                        </button>
                        <span class="coord-tooltip coord-tooltip-short coord-tooltip-align-input" id="coord-tooltip-layername-${layer.id}" role="tooltip">
                            <button type="button" class="coord-tooltip-close" aria-label="Tooltip schliessen">×</button>
                            <span class="coord-tooltip-text">Marterial/Substanz</span>
                        </span>
                    </label>
                    <input type="text" id="layername-${layer.id}" name="layername" placeholder="Schichtbezeichnung"
                              data-card-id="${card.id}" data-layer-id="${layer.id}" value="${layer.name || ''}">
                    <div class="layername-menu" hidden>
                        <div class="layername-menu-header">
                            <span>Auswahl</span>
                            <button type="button" class="layername-menu-close" aria-label="Liste schliessen">×</button>
                        </div>
                        <div class="layername-menu-list" role="listbox" aria-label="Schichtnamen">
                            ${getLayerNameOptionButtonsMarkup(layer.name || '')}
                        </div>
                    </div>
                </div>
                <div class="location-input-group height-group">
                    <label class="coord-label-wrap coord-label-wrap-full" for="layerheight-${layer.id}">
                        <span class="required-label-prefix"><span class="required-marker" aria-hidden="true">*</span><span class="coord-label-text">Höhe<span class="card-title-total">(cm)</span></span></span>
                        <button type="button" class="coord-info-btn" data-card-id="${layer.id}" data-coord-kind="layerheight" aria-label="Info zu Schichthoehe">
                            <i class="bi bi-question-circle"></i>
                        </button>
                        <span class="coord-tooltip coord-tooltip-right coord-tooltip-short" id="coord-tooltip-layerheight-${layer.id}" role="tooltip">
                            <button type="button" class="coord-tooltip-close" aria-label="Tooltip schliessen">×</button>
                            <span class="coord-tooltip-text">Schichtmächtigkeit</span>
                        </span>
                    </label>
                    <input type="number" id="layerheight-${layer.id}" name="layerheight" min="0" step="1" placeholder="cm"
                           data-card-id="${card.id}" data-layer-id="${layer.id}" value="${heightInCm}">
                </div>
            </div>
        `;
        fragment.appendChild(layerDiv);

        const separatorDiv = document.createElement('div');
        separatorDiv.className = 'layer-separator';
        separatorDiv.innerHTML = `
            <button class="add-layer-btn" aria-label="Schicht hier einfügen" data-card-id="${card.id}" data-layer-index="${layerIndex}">+</button>
            <div class="layer-separator-metric" aria-live="polite">${boundaryText}</div>
        `;
        fragment.appendChild(separatorDiv);
    });

    container.appendChild(fragment);
}

/**
 * Updates computed layer metric labels in-place for one borehole card
 * Keeps current input focus/caret because DOM inputs are not recreated
 * @param {object} card - Card data object
 */
function refreshLayerMetricLabels(card) {
    const cardElem = document.getElementById(card.id);
    if (!cardElem) return;

    const layersContainer = cardElem.querySelector('.layers-container');
    if (!layersContainer) return;

    const baseNhn = (typeof card.nhn === 'number') ? card.nhn : 0;
    let cumulativeDepth = 0;

    card.layers.forEach((layer, layerIndex) => {
        const layerHeightM = (typeof layer.height === 'number') ? (layer.height / 100) : 0;
        const topDepthM = cumulativeDepth;
        const bottomDepthM = topDepthM + layerHeightM;

        const bottomNhnText = `${(baseNhn - bottomDepthM).toFixed(2)} m`;
        const bottomDepthText = `${bottomDepthM.toFixed(2)} m`;

        const layerElem = document.getElementById(layer.id);
        if (!layerElem) {
            cumulativeDepth = bottomDepthM;
            return;
        }

        const separatorElem = layerElem.nextElementSibling;
        if (separatorElem && separatorElem.matches('.layer-separator')) {
            const metricLine = separatorElem.querySelector('.layer-separator-metric');
            if (metricLine) {
                metricLine.textContent = `NHN: ${bottomNhnText} | Tiefe: ${bottomDepthText}`;
            }
        }

        cumulativeDepth = bottomDepthM;
    });
}

// === CARD RENDER/UPDATE FUNCTIONS ===

/**
 * Creates a new card element for a borehole
 * @param {object} card - Card data object
 * @param {number} index - Index of the card in the grid
 * @returns {HTMLElement} Fully constructed card element
 */
function createCardElement(card, index) {
    const cardElem = document.createElement('div');
    cardElem.className = 'card base-card';
    cardElem.id = card.id;

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
        <div class="card-title"><i class="bi bi-database-fill" style="margin-right: 0.5rem;"></i>Bohrung ${index + 1}</div>
        <button class="delete-card-btn" aria-label="Bohrung löschen" data-card-id="${card.id}">×</button>
    `;
    cardElem.appendChild(header);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'card-details';
    detailsDiv.innerHTML = `
        <div class="location-input-group">
            <label for="card-title-${card.id}">Titel</label>
            <input type="text" id="card-title-${card.id}" name="card-title-input" placeholder="RKS ${index + 1}"
                   data-card-id="${card.id}" value="${card.title || ''}">
        </div>
        <div class="location-input-group epsg-group">
            <label for="epsg-${card.id}">EPSG</label>
            <select id="epsg-${card.id}" name="epsg" data-card-id="${card.id}">
${getEpsgSelectOptions(card.epsg || '4326')}
            </select>
        </div>
    `;
    cardElem.appendChild(detailsDiv);

    const mapDiv = document.createElement('div');
    mapDiv.className = 'card-map';
    mapDiv.id = `map-${card.id}`;
    cardElem.appendChild(mapDiv);

    const locationDiv = document.createElement('div');
    locationDiv.className = 'card-location';
    locationDiv.innerHTML = `
        <div class="location-input-group">
            <label class="lat-label coord-label-wrap" for="lat-${card.id}">
                <span class="required-label-prefix"><span class="required-marker" aria-hidden="true">*</span><span class="coord-label-text">Latitude</span></span>
                <button type="button" class="coord-info-btn" data-card-id="${card.id}" data-coord-kind="first" aria-label="Info zu Latitude">
                    <i class="bi bi-question-circle"></i>
                </button>
                <span class="coord-tooltip" id="coord-tooltip-first-${card.id}" role="tooltip">
                    <button type="button" class="coord-tooltip-close" aria-label="Tooltip schliessen">×</button>
                    <span class="coord-tooltip-text"></span>
                </span>
            </label>
            <input type="text" id="lat-${card.id}" name="latitude" data-card-id="${card.id}" placeholder="x">
        </div>
        <div class="location-input-group">
            <label class="lng-label coord-label-wrap" for="lng-${card.id}">
                <span class="required-label-prefix"><span class="required-marker" aria-hidden="true">*</span><span class="coord-label-text">Longitude</span></span>
                <button type="button" class="coord-info-btn" data-card-id="${card.id}" data-coord-kind="second" aria-label="Info zu Longitude">
                    <i class="bi bi-question-circle"></i>
                </button>
                <span class="coord-tooltip coord-tooltip-center" id="coord-tooltip-second-${card.id}" role="tooltip">
                    <button type="button" class="coord-tooltip-close" aria-label="Tooltip schliessen">×</button>
                    <span class="coord-tooltip-text"></span>
                </span>
            </label>
            <input type="text" id="lng-${card.id}" name="longitude" data-card-id="${card.id}" placeholder="y">
        </div>
        <div class="location-input-group nhn-group">
            <label class="coord-label-wrap" for="nhn-${card.id}">
                <span class="required-label-prefix"><span class="required-marker" aria-hidden="true">*</span><span class="coord-label-text">GOK<span class="card-title-total">(m)</span></span></span>
                <button type="button" class="coord-info-btn" data-card-id="${card.id}" data-coord-kind="nhn" aria-label="Info zu GOK">
                    <i class="bi bi-question-circle"></i>
                </button>
                <span class="coord-tooltip coord-tooltip-right coord-tooltip-short" id="coord-tooltip-nhn-${card.id}" role="tooltip">
                    <button type="button" class="coord-tooltip-close" aria-label="Tooltip schliessen">×</button>
                    <span class="coord-tooltip-text">Gelaendeoberkante</span>
                </span>
            </label>
            <input type="number" id="nhn-${card.id}" name="nhn" min="0" step="0.01" placeholder="0 m"
                   data-card-id="${card.id}" value="${card.nhn || ''}">
        </div>
    `;
    cardElem.appendChild(locationDiv);

    // Do not call updateCoordsInputs here because the element may not
    // yet be appended to the document. Call it after appending.

    const layersContainer = document.createElement('div');
    layersContainer.className = 'layers-container';
    cardElem.appendChild(layersContainer);
    renderLayers(card, layersContainer);

    return cardElem;
}

// === ADD CARD FUNCTIONS ===

/**
 * Creates an add-button element for inserting new boreholes
 * @param {number} index - Position where new card would be inserted
 * @returns {HTMLElement} Button element with add styling
 */
function createAddBtn(index) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.setAttribute('aria-label', 'Bohrung hinzufügen');
    addBtn.textContent = '+';
    addBtn.dataset.index = index;
    return addBtn;
}

// === UPDATE UI CONTROLS ===

/**
 * Updates card numbering, placeholders, and delete button visibility
 * Called after add/delete operations to keep UI consistent
 */
function updateUICardControls() {
    
    const cards = gridContent.querySelectorAll('.card');
    const addBtns = gridContent.querySelectorAll('.add-card-btn');
    const totalCards = cardsData.length;
    const isSingleCard = totalCards <= 1;

    cards.forEach((cardElem, index) => {
        const title = cardElem.querySelector('.card-title');
        if (title) {
            title.innerHTML = `<i class="bi bi-database-fill" style="margin-right: 0.5rem;"></i>Bohrung ${index + 1} <span class="card-title-total">von ${totalCards}</span>`;
        }
        const titleInput = cardElem.querySelector('input[name="card-title-input"]');
        if (titleInput) {
            titleInput.placeholder = `RKS ${index + 1}`;
        }
        const deleteBtn = cardElem.querySelector('.delete-card-btn');
        if (deleteBtn) {
            deleteBtn.classList.toggle('invisible', isSingleCard);
        }
    });

    addBtns.forEach((btn, index) => {
        btn.dataset.index = index;
    });
}

// === INITIALIZE INFO-CARD AND DASHBOARD ===

/**
 * Renders complete UI with info card, borehole cards, and dashboard
 * This is the main rendering function that rebuilds the interface
 */
function initialRender() {
    gridContent.innerHTML = '';

    // INFO-CARD

    const infoDiv = document.createElement('div');
    infoDiv.className = 'info base-card info-hidden';
    infoDiv.id = 'info-base-card';
    infoDiv.innerHTML = `
        <div class="card-header">
            <div class="card-title"><i class="bi bi-lightbulb-fill" style="margin-right: 0.5rem;"></i>GUIDE</div>
            <div class="hide-info-btn" aria-label="Guide ausblenden"><i class="bi bi-x-lg"></i></div>
        </div>
        <div class="card-details" style="display: block; padding: 1.25rem; font-size: 0.95rem; line-height: 1.6;">
            <div class="card-title"><i class="bi bi-1-circle-fill" style="margin-right: 0.5rem;"></i>Hinweise</div>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-exclamation-triangle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>RUMMZ 1 ist ein Prototyp (MVP). Es gibt Sekundärfunktionen, die noch nicht vollständig implementiert sind.</span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-stack" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>Das Akronym RUMMZ steht für Rapide Untergrund Material Modellierung und Zonierung. RUMMZ erstellt aus Baugrundinformationen ein 3D-BIM-Baugrundmodell im IFC-Format.</span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-database-fill-add" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>Angaben zu einer Bohrung und einer Schicht ist das Minimum. Beliebig viele Bohrungen und Schichten sind möglich.</span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-magic" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>RUMMZ erstellt daraus die 3D-Bohrkerne und 3D-Ausdehnungsgeometrien. Ihre Angaben werden den Objekten als Eigenschaften hinzugefügt.</span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-bar-chart-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>Ihr 3D-BIM-Baugrundmodell können Sie im Dashboard abfragen, konfigurieren und herunterladen als IFC-Datei mit sauberem IFC-Schema.</span>
                    </div>
                </li>
            </ul>
        </div>
        <div class="card-details" style="display: block; padding: 1.25rem; font-size: 0.95rem; line-height: 1.6;">
            <div class="card-title"><i class="bi bi-2-circle-fill" style="margin-right: 0.5rem;"></i>Voreinstellungen</div>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-geo-alt-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Für die Georeferenzierung des 3D-BIM-Baugrundmodells stehen verschiedene Koordinatensystem zur Auswahl. Der erste Bohrpunkt dient als Referenzpunkt für die Georeferenzierung. Ihre IFC-Datei enthält eine optionale Geometrie, die auf diesen Referenzpunkt zeigt, um den Punkt optisch schnell zu erkennen.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-globe" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Die Längen- und Breitengrade werden für das 3D-BIM-Baugrundmodell in Meter umgerechnet, basierend auf dem Referenzpunkt. Für linienhafte oder großflächige Strukturen (z.B. Straßen, Trassen) muss die Erdkrümmung berücksichtigt werden. Dieses Feature wird 2027 integriert.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-database-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Jeder Bohrkern ist standardmäßig auf einen Durchmesser von einem Meter eingestellt, um eine bessere optische Darstellung zu gewährleisten.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-triangle-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Zur Verbindung der Koordinatenpunkte wird die Delaunay-Triangulation verwendet, um aus diskreten Punktdaten geschlossene Flächengeometrien zu erzeugen.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-pie-chart-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Die Ausdehnungsgeometrien basieren auf einem Voronoi-Diagramm, das die Umgebung in logisch getrennte Einflussbereiche segmentiert.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-box-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Eine Bounding-Box (Minimum 20 Meter) mit einem Skalierungsfaktor von 1.5 begrenzt die räumliche Ausdehnung der Zellen und sorgt für eine kontrollierte Darstellung innerhalb der Szene.
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-grid-3x3-gap-fill" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Das Raster (Gitternetzlinien bzw. Grid) in der 3D-Szene des Dashboards dient lediglich zur räumlichen Orientierung. Es entspricht der horizontalen Fläche der Bounding-Box und ist standardmäßig in 5×5 Segmente unterteilt. Die vertikale Position des Grids liegt mittig zwischen dem höchsten Punkt der obersten Schicht und dem tiefsten Punkt der untersten Schicht.
                        </span>
                    </div>
                </li>
            </ul>
        </div>
        <div class="card-details" style="display: block; padding: 1.25rem; font-size: 0.95rem; line-height: 1.6;">
            <div class="card-title"><i class="bi bi-3-circle-fill" style="margin-right: 0.5rem;"></i>Geplante Erweiterungen</div>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em; color: #198754;"></i>
                    <div id="guide">
                        <span style="color: #a1a1a1;">
                            Koordinaten selber eingeben
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em; color: #198754;"></i>
                    <div id="guide">
                        <span style="color: #a1a1a1;">
                            Tiefenpositionen flexibilisieren
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em; color: #198754;"></i>
                    <div id="guide">
                        <span style="color: #a1a1a1;">
                            Autofill-Optionen
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Wasserstände abbilden
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Add-Data-Optionen (DIN)
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Geometrieabschrägungen
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            DGM-Verschnitt in IFC
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Projektion mit Erdkrümmung
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            OSM-Overlay in Vorschau
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            DGM-Verschnitt in Vorschau
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Upgrade IFC-Versionen
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Switch Plane/DGM-Surface
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Dynamisches Bohrungs-Icon
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            IFC ohne Triangulation
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            QGIS-/Blender-Plugin
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Version auf Englisch
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Voxel-Modell entwickeln
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Dashboard-Maximierung
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            3D-Visualisierung gamifizieren
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Bohrprofile/Volumen switchen
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Transparenz-/Abstands-Regler
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Bohrungsdurchmesser-Regler
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Refresh-Warnung
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Default-Höhen durch Dienst
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Sharing-Page
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            OSM3D-Integration
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Kosten-Heatmap
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            VR/AR-Switcher
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Grid-Sichtbarkeit switchen
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Marker-Übernahme in Maps
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Download PDF-Summary
                        </span>
                    </div>
                </li>
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-check-circle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>
                            Import Bohrpunkte
                        </span>
                    </div>
                </li>
            </ul>
        </div>
    `;

    gridContent.appendChild(infoDiv);

    cardsData.forEach((card, index) => {
        gridContent.appendChild(createAddBtn(index));
        const cardElem = createCardElement(card, index);
        gridContent.appendChild(cardElem);
        // Now that the element is in the DOM, update labels/values
        updateCoordsInputs(card.id, card.coords);
    });

    gridContent.appendChild(createAddBtn(cardsData.length));
    
    // DASHBOARD-CARD

    const previewDiv = document.createElement('div');
    previewDiv.className = 'preview base-card';
    
    // Header
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `<div class="card-title"><i class="bi bi-bar-chart-fill" style="margin-right:0.5rem;"></i>Dashboard</div><i class="bi bi-fullscreen"></i>`;
    previewDiv.appendChild(header);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'card-details';
    detailsDiv.innerHTML = `
        <div class="location-input-group">
            <label for="dashboard-project-title">Projekttitel</label>
            <input type="text" id="dashboard-project-title" name="dashboard-project-title" placeholder="optional" value="${projectTitle || ''}">
        </div>
        <div class="location-input-group epsg-group">
            <label for="dashboard-project-type">Projektion</label>
            <input type="text" id="dashboard-project-type" name="dashboard-project-type" value="EQUIR." readonly>
        </div>
    `;
    previewDiv.appendChild(detailsDiv);

    // THREE.JS-SCENE
    const mapDiv = document.createElement('div');
    mapDiv.className = 'card-map';
    mapDiv.id = 'dashboard-map';
    mapDiv.style.backgroundImage = "url('assets/render.png')";
    mapDiv.style.backgroundSize = 'cover';
    mapDiv.style.backgroundRepeat = 'no-repeat';
    mapDiv.style.backgroundPosition = 'center';
    mapDiv.style.backgroundColor = '#eaf0f6';
    mapDiv.innerHTML = `
        <div class="map-overlay-controls">
            <div class="map-icon-stack" aria-label="Map controls" title="Map controls">
                <i class="bi bi-geo-alt" title="Bohrpunkt"></i>
                <i class="bi bi-map" title="Karte"></i>
                <i class="bi bi-database" title="Zylinder"></i>
                <i class="bi bi-box" title="Volumen"></i>
                <i class="bi bi-layers" title="Abstand"></i>
                <i class="bi bi-globe" title="Oberfläche"></i>
            </div>
            <div class="map-attribution">
                <a href="https://threejs.org" target="_blank" rel="noopener noreferrer">three.js</a><span>&nbsp;|</span>
                <a href="https://github.com/d3/d3-delaunay" target="_blank" rel="noopener noreferrer">d3.js</a><span>&nbsp;|</span>
                <a href="https://github.com/proj4js/proj4js" target="_blank" rel="noopener noreferrer">proj4.js</a><span>&nbsp;|</span>
                <a href="https://www.chartjs.org" target="_blank" rel="noopener noreferrer">chart.js</a><span>&nbsp;|</span>
                <a href="https://getbootstrap.com" target="_blank" rel="noopener noreferrer">bootstrap.js</a>
            </div>
        </div>
    `;
    previewDiv.appendChild(mapDiv);

    const geoToggle = mapDiv.querySelector('.map-icon-stack .bi-geo-alt');
    if (geoToggle) {
        geoToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isActive = geoToggle.classList.toggle('active');
            geoToggle.classList.toggle('bi-geo-alt-fill', isActive);
            geoToggle.classList.toggle('bi-geo-alt', !isActive);
            geoToggle.setAttribute('aria-pressed', String(isActive));
            window.dispatchEvent(new CustomEvent('toggleBoreholeMarkers', { detail: { visible: isActive } }));
        });
    }

    // DOWNLOAD-BUTTONS-SECTION

    const locationDiv = document.createElement('div');
    locationDiv.className = 'card-location';
    locationDiv.innerHTML = `
        <!--<div class="location-input-group">
            <label>Download</label>
            <button type="button" id="btn-toggle-pdf" class="dashboard-button">PDF</button>
        </div>-->
        <div class="location-input-group">
            <label for="dashboard-ifc-epsg">IFC-EPSG</label>
            <select id="dashboard-ifc-epsg" name="dashboard-ifc-epsg">
${getEpsgSelectOptions(dashboardSelectedEPSG)}
            </select>
        </div>
        <div class="location-input-group">
            <label>Download</label>
            <button type="button" id="btn-toggle-elements" class="dashboard-button">IFC4</button>
        </div>
    `;

    previewDiv.appendChild(locationDiv);
    
    // GRID-INFO-SECTIONS

    const calculationDiv1 = document.createElement('div');
    calculationDiv1.className = 'grid-data';
    calculationDiv1.innerHTML = `
        <div class="location-input-group">
            <label for="grid-size-m">Grid-Size in m</label>
            <input type="text" id="grid-size-m" name="grid-size-m" placeholder="0" readonly>
        </div>
        <div class="location-input-group">
            <label for="grid-size-m2">Grid-Size in m²</label>
            <input type="text" id="grid-size-m2" name="grid-size-m2" placeholder="0" readonly>
        </div>
    `;

    previewDiv.appendChild(calculationDiv1);

    const calculationDiv2 = document.createElement('div');
    calculationDiv2.className = 'card-location';
    calculationDiv2.innerHTML = `
        <div class="location-input-group">
            <label for="division-m">Division in m</label>
            <input type="text" id="division-m" name="division-m" placeholder="0" readonly>
        </div>
        <div class="location-input-group">
            <label for="division-m2">Division in m²</label>
            <input type="text" id="division-m2" name="division-m2" placeholder="0" readonly>
        </div>
    `;

    previewDiv.appendChild(calculationDiv2);

    // CHART.JS-SECTIONS

    const legendenDiv = document.createElement('div');
    legendenDiv.id = 'legende';
    legendenDiv.className = 'card-location';
    legendenDiv.style.flexDirection = 'column';
    // Add the title directly
    legendenDiv.innerHTML = '<div class="static-chart-title"><i class="bi bi-info-circle-fill" style="margin-right:0.5rem;"></i>Legende</div><span id="card-title-total">await data...</span>';
    previewDiv.appendChild(legendenDiv);

    // Vergleich der Bohrtiefen als Balkendiagramm
    const bohrtiefenDiv = document.createElement('div');
    bohrtiefenDiv.id = 'bohrtiefen';
    bohrtiefenDiv.className = 'card-location'; // Wiederverwendung von Styles für das Layout
    bohrtiefenDiv.style.flexDirection = 'column';
    // Add the title directly
    bohrtiefenDiv.innerHTML = '<div class="static-chart-title"><i class="bi bi-bar-chart-fill" style="margin-right:0.5rem;display:inline-block;transform:rotate(180deg)"></i>Vergleich Bohrungen<span class="card-title-total">(cm)</span></div><span id="card-title-total">await data...</span>';
    previewDiv.appendChild(bohrtiefenDiv);

    // Vergleich Materialmächtigkeit nach Bohrzylindern als Donut-Diagramm
    const materialrankingDiv = document.createElement('div');
    materialrankingDiv.id = 'materialranking';
    materialrankingDiv.className = 'card-location';
    materialrankingDiv.style.flexDirection = 'column';
    // Add the title directly
    materialrankingDiv.innerHTML = '<div class="static-chart-title"><i class="bi bi-pie-chart-fill" style="margin-right:0.5rem;"></i>Vergleich Material<span class="card-title-total">(cm)</span></div><span id="card-title-total">await data...</span>';
    previewDiv.appendChild(materialrankingDiv);

    // Vergleich Gesamtvolumen der Materialschichten als Balken
    const volumenrankingDiv = document.createElement('div');
    volumenrankingDiv.id = 'volumenranking';
    volumenrankingDiv.className = 'card-location';
    volumenrankingDiv.style.flexDirection = 'column';
    // Add the title directly
    volumenrankingDiv.innerHTML = '<div class="static-chart-title"><i class="bi bi-bar-chart-fill" style="margin-right:0.5rem;display:inline-block;transform:rotate(90deg)"></i>Vergleich Volumen<span class="card-title-total">(m³)</span></div><span id="card-title-total">await data...</span>';
    previewDiv.appendChild(volumenrankingDiv);

    gridContent.appendChild(previewDiv);

    cardsData.forEach(initLeafletMap);
    updateUICardControls();
}

// === EVENT DELEGATION & HANDLERS ===

/**
 * Central click handler for card/layer management
 * Handles: add/delete cards, add/delete layers, info card toggle
 */
gridContent.addEventListener('click', function(event) {
    const target = event.target;
    if (target.classList.contains('invisible')) return;

    const layerNameCloseBtn = target.closest('.layername-menu-close');
    if (layerNameCloseBtn) {
        event.preventDefault();
        event.stopPropagation();
        const layerGroup = layerNameCloseBtn.closest('.layername-input-group');
        if (layerGroup) hideLayerNameMenu(layerGroup);
        return;
    }

    const layerNameOption = target.closest('.layername-option');
    if (layerNameOption) {
        event.preventDefault();
        event.stopPropagation();
        const layerGroup = layerNameOption.closest('.layername-input-group');
        const input = layerGroup?.querySelector('input[name="layername"]');
        if (input) {
            applyLayerNameInputValue(input, layerNameOption.dataset.value || '');
            hideLayerNameMenu(layerGroup);
            input.focus();
        }
        return;
    }

    const closeBtn = target.closest('.coord-tooltip-close');
    if (closeBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tooltip = closeBtn.closest('.coord-tooltip');
        if (tooltip) {
            tooltip.classList.remove('is-visible');
            tooltip.classList.add('coord-tooltip-dismissed');
        }
        return;
    }

    const infoBtn = target.closest('.coord-info-btn');
    if (infoBtn) {
        event.preventDefault();
        event.stopPropagation();
        const cardId = infoBtn.dataset.cardId;
        const coordKind = infoBtn.dataset.coordKind;
        if (cardId && coordKind) {
            toggleCoordTooltip(cardId, coordKind);
        }
        return;
    }

    if (target.closest('.color-swatch')) {
        event.preventDefault();
        event.stopPropagation();

        const swatch = target.closest('.color-swatch');
        const cardId = swatch.dataset.cardId;
        const layerId = swatch.dataset.layerId;
        const color = swatch.dataset.color;
        const card = cardsData.find(c => c.id === cardId);
        const layer = card?.layers.find(l => l.id === layerId);

        if (layer) {
            layer.color = color;
            const colorInput = document.querySelector(`.layer-color-picker[data-card-id="${cardId}"][data-layer-id="${layerId}"]`);
            if (colorInput) {
                colorInput.value = color;
            }
            const layerElement = document.getElementById(layerId);
            if (layerElement) {
                layerElement.style.borderLeftColor = color;
            }
            triggerVisualisationUpdate();
        }
        return;
    }

    if (target.matches('.add-card-btn')) {
        gridContent.classList.add('grid-is-adding');
        const index = parseInt(target.dataset.index, 10);

        let initialView = null;
        if (index > 0 && cardsData[index - 1]) {
            const prevMap = mapInstances[cardsData[index - 1].id];
            if (prevMap) {
                initialView = { center: prevMap.getCenter(), zoom: prevMap.getZoom() };
            }
        }

        const newCardData = createNewCard(index, initialView, lastSelectedEPSG);
        cardsData.splice(index, 0, newCardData);
        const newCardElem = createCardElement(newCardData, index);
        const newAddBtn = createAddBtn(index);

        newAddBtn.classList.add('fade-in');
        newCardElem.classList.add('fade-in');
        setTimeout(() => {
            newAddBtn.classList.remove('fade-in');
            newCardElem.classList.remove('fade-in');
        }, 500);

        target.before(newAddBtn, newCardElem);
        // After inserting into DOM, ensure coords/labels reflect EPSG
        updateCoordsInputs(newCardData.id, newCardData.coords);
        initLeafletMap(newCardData);
        updateUICardControls();
        triggerVisualisationUpdate();

        setTimeout(() => {
            gridContent.classList.remove('grid-is-adding');
        }, 0);
    }

    if (target.matches('.delete-card-btn')) {
        const cardId = target.dataset.cardId;
        if(cardsData.length > 1) {
            const cardElem = document.getElementById(cardId);
            const precedingAddBtn = cardElem.previousElementSibling;

            cardElem.classList.add('fade-out');
            if(precedingAddBtn && precedingAddBtn.matches('.add-card-btn')) {
                precedingAddBtn.classList.add('fade-out');
            }

            setTimeout(() => {
                const cardIndex = cardsData.findIndex(c => c.id === cardId);
                if (cardIndex > -1) {
                    if (mapInstances[cardId]) {
                        mapInstances[cardId].remove();
                        delete mapInstances[cardId];
                    }
                    delete markerInstances[cardId];
                    cardsData.splice(cardIndex, 1);
                    if(cardElem) cardElem.remove();
                    if(precedingAddBtn && precedingAddBtn.matches('.add-card-btn')) {
                        precedingAddBtn.remove();
                    }
                    updateUICardControls();
                    triggerVisualisationUpdate();
                }
            }, 300);
        }
    }

    if (target.matches('.add-layer-btn')) {
        const cardId = target.dataset.cardId;
        const card = cardsData.find(c => c.id === cardId);
        if (card) {
            const layerIndex = parseInt(target.dataset.layerIndex, 10);
            const newLayer = createNewLayer(card.id, card.layers.length + 1);
            card.layers.splice(layerIndex + 1, 0, newLayer);
    
            const cardElem = document.getElementById(cardId);
            const layersContainer = cardElem.querySelector('.layers-container');
            renderLayers(card, layersContainer);
    
            const newLayerElem = document.getElementById(newLayer.id);
            if (newLayerElem) {
                newLayerElem.classList.add('fade-in');

                // Find the separator DIV that comes directly after the new layer
                const separatorElem = newLayerElem.nextElementSibling;

                // Scroll the separator (which contains the '+') into view
                if (separatorElem) {
                    separatorElem.scrollIntoView({ behavior: 'smooth', block: 'end' });
                } else {
                    // Fallback if the separator isn't found for some reason
                    newLayerElem.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
                
                setTimeout(() => newLayerElem.classList.remove('fade-in'), 500);
            }
    
            if (mapInstances[card.id]) {
                setTimeout(() => mapInstances[card.id].invalidateSize(), 400);
            }
            triggerVisualisationUpdate();
        }
    }

    if (target.matches('.delete-layer-btn')) {
        const cardId = target.dataset.cardId;
        const layerId = target.dataset.layerId;
        const card = cardsData.find(c => c.id === cardId);

        if (card && card.layers.length > 1) {
            const layerElem = document.getElementById(layerId);
            const separatorElem = layerElem.nextElementSibling;

            layerElem.classList.add('fade-out');
            if (separatorElem && separatorElem.matches('.layer-separator')) {
                separatorElem.classList.add('fade-out');
            }

            setTimeout(() => {
                card.layers = card.layers.filter(layer => layer.id !== layerId);
                const cardElem = document.getElementById(cardId);
                const layersContainer = cardElem.querySelector('.layers-container');
                renderLayers(card, layersContainer);
                if (mapInstances[card.id]) {
                    setTimeout(() => mapInstances[card.id].invalidateSize(), 400);
                }
                triggerVisualisationUpdate();
            }, 300);
        }
    }

    if (target.closest('.hide-info-btn')) {
        const infoCard = document.querySelector('.info');
        if (infoCard) {
            infoCard.classList.add('info-hidden');
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.closest('.coord-label-wrap')) return;
    hideCoordTooltips();

    if (!event.target.closest('.layername-input-group')) {
        hideAllLayerNameMenus();
    }
});

document.addEventListener('focusin', function(event) {
    if (!event.target.closest('.layername-input-group')) {
        hideAllLayerNameMenus();
    }
});

gridContent.addEventListener('focusin', function(event) {
    const target = event.target;
    if (target.matches('input[name="layername"]')) {
        showLayerNameMenuForInput(target);
    }
});

gridContent.addEventListener('keydown', function(event) {
    const target = event.target;
    if (!target.matches('input[name="layername"]')) return;

    const group = target.closest('.layername-input-group');
    if (!group) return;

    const menu = group.querySelector('.layername-menu');
    const isOpen = menu && !menu.hidden;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) {
            showLayerNameMenuForInput(target);
            return;
        }

        const options = getLayerNameOptions(group);
        if (!options.length) return;

        const currentIndex = getActiveLayerNameOptionIndex(group);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const fallbackIndex = direction > 0 ? -1 : options.length;
        const nextIndex = currentIndex === -1 ? fallbackIndex + direction : currentIndex + direction;
        const wrappedIndex = (nextIndex + options.length) % options.length;
        setActiveLayerNameOption(group, wrappedIndex, true);
        return;
    }

    if (event.key === 'Enter') {
        if (!isOpen) return;
        const options = getLayerNameOptions(group);
        if (!options.length) return;

        event.preventDefault();
        const activeIndex = getActiveLayerNameOptionIndex(group);
        const optionToApply = options[Math.max(0, activeIndex)];
        if (optionToApply) {
            applyLayerNameInputValue(target, optionToApply.dataset.value || '');
            hideLayerNameMenu(group);
        }
        return;
    }

    if (event.key === 'Escape') {
        if (!isOpen) return;
        event.preventDefault();
        hideLayerNameMenu(group);
        return;
    }

    if (event.key === 'Tab' && isOpen) {
        hideLayerNameMenu(group);
    }
});

gridContent.addEventListener('input', function(event) {
    const target = event.target;
    if (target.name === 'latitude' || target.name === 'longitude') {
        const coordCardId = target.dataset.cardId;
        if (coordCardId) {
            clearCoordsInputError(coordCardId);
        }
    }

    const cardId = target.dataset.cardId;
    const card = cardsData.find(c => c.id === cardId);
    if (!card) return;

    if (target.name === 'card-title-input') {
        card.title = target.value;
    } else if (target.name === 'nhn') {
        card.nhn = target.value ? parseFloat(target.value) : null;
        refreshLayerMetricLabels(card);
        triggerVisualisationUpdate();
    }

    const layerId = target.dataset.layerId;
    if (target.classList.contains('layer-color-picker')) {
        const layer = card.layers.find(l => l.id === layerId);
        if (layer) {
            layer.color = target.value;
            // Update border color for instant visual feedback
            document.getElementById(layer.id).style.borderLeftColor = target.value;
        }
        return;
    }

    const layer = card.layers.find(l => l.id === layerId);
    if (!layer) return;

    if (target.name === 'layername') {
        layer.name = target.value;
        applyAutoColorForLayer(card.id, layer);
        showLayerNameMenuForInput(target);
    } else if (target.name === 'layerheight') {
        layer.height = target.value ? parseFloat(target.value, 10) : null;
        refreshLayerMetricLabels(card);
    }
    triggerVisualisationUpdate();
});

// This listener triggers the visualisation update only when the color selection is final
gridContent.addEventListener('change', function(event) {
    const target = event.target;
    if (target.classList.contains('layer-color-picker')) {
        triggerVisualisationUpdate();
        return;
    }

    if (target.name === 'latitude' || target.name === 'longitude') {
        const cardId = target.dataset.cardId;
        if (cardId) {
            commitCoordinateInputs(cardId);
        }
        return;
    }

    if (target.name === 'epsg') {
        const cardId = target.dataset.cardId;
        const card = cardsData.find(c => c.id === cardId);
        if (card) {
            const epsgCode = getSelectedEpsg(cardId);
            card.epsg = epsgCode;
            lastSelectedEPSG = epsgCode;
            updateCoordsLabel(cardId, epsgCode);
            if (card.coords) {
                updateCoordsInputs(cardId, card.coords);
            }
        }
    }

    if (target.id === 'dashboard-ifc-epsg') {
        dashboardSelectedEPSG = target.value;
        lastSelectedEPSG = target.value;
    }
});

// === LEAFLET MAP INITIALIZATION ===

/**
 * Updates coordinate display inputs based on selected EPSG code
 * Converts internal WGS84 coordinates to target projection
 * @param {string} cardId - Card identifier
 * @param {object} coords - Coordinates object with lat/lng properties
 */
function updateCoordsInputs(cardId, coords) {
    const latInput = document.getElementById(`lat-${cardId}`);
    const lngInput = document.getElementById(`lng-${cardId}`);
    const epsgCode = getSelectedEpsg(cardId);
    updateCoordsLabel(cardId, epsgCode);

    if (!latInput || !lngInput) return;

    if (coords) {
        const converted = resolveCoordsToEpsg(coords, epsgCode);
        if (converted && Array.isArray(converted)) {
            const [first, second] = converted;
            latInput.value = first !== undefined && first !== null ? first.toFixed(5) : '';
            lngInput.value = second !== undefined && second !== null ? second.toFixed(5) : '';
            clearCoordsInputError(cardId);
        } else {
            latInput.value = '';
            lngInput.value = '';
        }
    } else {
        latInput.value = '';
        lngInput.value = '';
        clearCoordsInputError(cardId);
    }
}

/**
 * Shows a static offline fallback image inside the map container.
 * @param {HTMLElement} mapElement
 */
function showMapOfflineFallback(mapElement) {
    if (!mapElement) return;
    mapElement.innerHTML = '';
    mapElement.style.backgroundImage = "url('assets/no-net.png')";
    mapElement.style.backgroundRepeat = 'no-repeat';
    mapElement.style.backgroundPosition = 'center';
    mapElement.style.backgroundSize = 'cover';
    mapElement.style.backgroundColor = '#f4f4f4';
    mapElement.style.display = 'block';
    mapElement.style.backgroundClip = 'padding-box';
    mapElement.style.boxSizing = 'border-box';
    mapElement.dataset.mapError = 'true';
}

/**
 * Closes a Leaflet map instance and shows an offline fallback if needed.
 * @param {string} cardId
 * @param {HTMLElement} mapElement
 */
function failLeafletMap(cardId, mapElement) {
    if (mapInstances[cardId]) {
        try {
            mapInstances[cardId].remove();
        } catch (e) {
            console.warn('Failed to remove Leaflet map:', e);
        }
        delete mapInstances[cardId];
    }
    showMapOfflineFallback(mapElement);
}

/**
 * Initializes Leaflet map for a card if not already initialized
 * Sets up OpenStreetMap tiles, marker placement, and drag interaction
 * @param {object} card - Card data object with id and coords properties
 */
function initLeafletMap(card) {
    const mapId = `map-${card.id}`;
    const mapElement = document.getElementById(mapId);
    if (!mapElement || mapElement._leaflet_id || mapElement.dataset.mapError === 'true') return;

    if (typeof L === 'undefined' || !L.map || !L.tileLayer) {
        showMapOfflineFallback(mapElement, 'Leaflet oder Kartendienst nicht geladen');
        return;
    }

    let initialCenter = [51.505, 7.505];
    let initialZoom = 5;
    if (card.initialView) {
        initialCenter = card.initialView.center;
        initialZoom = card.initialView.zoom;
    }

    const map = L.map(mapId).setView(initialCenter, initialZoom);
    mapInstances[card.id] = map;

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    tileLayer.on('tileerror', () => {
        failLeafletMap(card.id, mapElement, 'Karte konnte nicht geladen werden. Zeige statischen Fallback.');
    });

    if (card.coords) {
        syncCardMarker(card, { centerMap: false });
        map.setView(card.coords, 13);
        updateCoordsInputs(card.id, card.coords);
    }

    map.on('click', function(e) {
        card.coords = e.latlng;
        syncCardMarker(card, { centerMap: false });
        updateCoordsInputs(card.id, e.latlng);
        triggerVisualisationUpdate();
    });
}

// === APP INITIALIZATION ===

/**
 * Initializes the application on page load
 * Sets up scroll buttons, event listeners, and creates first card
 */
function initializeApp() {
    document.getElementById('show-guide').addEventListener('click', (event) => {
        event.preventDefault();
        const infoCard = document.querySelector('.info');
        if (infoCard) {
            infoCard.classList.toggle('info-hidden');
        }
    });

    ensureProj4Defs();

    // Create the very first card
    cardsData.push(createNewCard(0, null, lastSelectedEPSG));
    initialRender();
}

initializeApp();

function decimalDegreesToIfcDMS(decimal) {
    const sign = Math.sign(decimal) >= 0 ? 1 : -1;
    const absValue = Math.abs(decimal);
    const degrees = Math.floor(absValue);
    const minutesFloat = (absValue - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
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

function buildIfcExport(fullIFC, boxReference, generateIFCFaceSet, generateIFCBoxSet, getNextIfcEntityId, selectedEpsg = '25833') {
    // Hilfsfunktion: Erzeugt 22-stellige GUIDs aus numerischen IDs
    function generateIFCGUID(idNumber) {
        const idStr = idNumber.toString();
        const paddingNeeded = 22 - idStr.length;
        if (paddingNeeded < 0) {
            throw new Error(`GUID-Wert zu lang: ${idStr.length} Zeichen (max 22)`);
        }
        return '0'.repeat(paddingNeeded) + idStr;
    }

    const ifcCrs = ifcProjectedCRSDefinitions[selectedEpsg] || ifcProjectedCRSDefinitions['4326'];
    const selectedEpsgLabel = ifcCrs.name;
    const selectedEpsgDescription = `EPSG:${selectedEpsg} - ${ifcCrs.name}`;
    const selectedEpsgZone = ifcCrs.zone === '$' ? '$' : `'${ifcCrs.zone}'`;

    // Koordinaten für Georeferenzierung aus dem ersten Bohrpunkt
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

    // Statischer Header und Georeferenzierungs-Geometrie hinzufügen
    fullIFC += `#1=IFCPROJECT('0000000000000000000001',$,'RUMMZ','Mit diesem Objekt sind die Projektbasisdaten bis inklusive 17 verbunden.',$,$,$,(#2),#9);\n`;
    fullIFC += `#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,#8);\n`;
    fullIFC += `#3=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#2,$,.MODEL_VIEW.,$);\n`;
    fullIFC += `#4=IFCAXIS2PLACEMENT3D(#5,#6,#7);\n`;
    fullIFC += `#5=IFCCARTESIANPOINT((0.,0.,0.));\n`;
    fullIFC += `#6=IFCDIRECTION((0.,0.,1.));\n`;
    fullIFC += `#7=IFCDIRECTION((1.,0.,0.));\n`;
    fullIFC += `#8=IFCDIRECTION((0.0,1.0));\n`;
    fullIFC += `#9=IFCUNITASSIGNMENT((#10,#11,#12));\n`;
    fullIFC += `#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);\n`;
    fullIFC += `#11=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n`;
    fullIFC += `#12=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);\n`;
    fullIFC += `#13=IFCLOCALPLACEMENT($,#4);\n`;
    fullIFC += `#14=IFCPROJECTEDCRS('${ifcCrs.identifier}','${ifcCrs.name}','${ifcCrs.datum}',$,'${ifcCrs.method}',${selectedEpsgZone},#10);\n`;
    fullIFC += `#15=IFCMAPCONVERSION(#2,#14,${mapConversionX.toFixed(3)},${mapConversionY.toFixed(3)},${refNhn.toFixed(2)},1.,0.,1.);\n`;

    const refLatDMS = decimalDegreesToIfcDMS(refLat);
    const refLonDMS = decimalDegreesToIfcDMS(refLon);

    // Georeferenzierungs-Geometrie (Geomarker)
    fullIFC += `#16=IFCSITE('0000000000000000000002',$,'0. Georeferenzierung','Dieses Objekt beinhaltet den Geomarker. Der Geomarker zeigt auf die Georeferenzierung dieser IFC-Datei. Das ist immer der erste Bohrpunkt',$,#13,$,$,.PARTIAL.,${refLatDMS},${refLonDMS},${refNhn.toFixed(2)},$,$);\n`;
    fullIFC += `#17=IFCRELAGGREGATES('0000000000000000000003',$,'Verbindung der Objekte RUMMZ und 0. Georeferenzierung.',$,#1,(#16));\n`;
    fullIFC += `#18=IFCSURFACESTYLE('Geomarker-Gelb',.BOTH.,(#19));\n`;
    fullIFC += `#19=IFCSURFACESTYLESHADING(#20,$);\n`;
    fullIFC += `#20=IFCCOLOURRGB($,1.,1.,0.);\n`;
    fullIFC += `#21=IFCCARTESIANPOINTLIST3D(((1.69990313053131,1.69990313053131,3.37193894386292),(1.90088465869026E-15,7.60353863476105E-15,5.06902589767952E-15),(-1.69990313053131,1.69990313053131,3.37193894386292),(1.69990313053131,-1.69990313053131,3.37193894386292),(-1.69990313053131,-1.69990313053131,3.37193894386292),(-1.69990313053131,-1.69990313053131,6.74387788772583),(1.69990313053131,-1.69990313053131,6.74387788772583),(-1.69990313053131,1.69990313053131,6.74387788772583),(1.69990313053131,1.69990313053131,6.74387788772583)));\n`;
    fullIFC += `#22=IFCINDEXEDPOLYGONALFACE((1,2,3));\n`;
    fullIFC += `#23=IFCINDEXEDPOLYGONALFACE((4,5,2));\n`;
    fullIFC += `#24=IFCINDEXEDPOLYGONALFACE((2,5,3));\n`;
    fullIFC += `#25=IFCINDEXEDPOLYGONALFACE((2,1,4));\n`;
    fullIFC += `#26=IFCINDEXEDPOLYGONALFACE((4,6,5));\n`;
    fullIFC += `#27=IFCINDEXEDPOLYGONALFACE((6,4,7));\n`;
    fullIFC += `#28=IFCINDEXEDPOLYGONALFACE((7,8,6));\n`;
    fullIFC += `#29=IFCINDEXEDPOLYGONALFACE((8,7,9));\n`;
    fullIFC += `#30=IFCINDEXEDPOLYGONALFACE((9,3,8));\n`;
    fullIFC += `#31=IFCINDEXEDPOLYGONALFACE((3,9,1));\n`;
    fullIFC += `#32=IFCINDEXEDPOLYGONALFACE((4,9,7));\n`;
    fullIFC += `#33=IFCINDEXEDPOLYGONALFACE((9,4,1));\n`;
    fullIFC += `#34=IFCINDEXEDPOLYGONALFACE((3,6,8));\n`;
    fullIFC += `#35=IFCINDEXEDPOLYGONALFACE((6,3,5));\n`;
    fullIFC += `#36=IFCPOLYGONALFACESET(#21,$,(#22,#23,#24,#25,#26,#27,#28,#29,#30,#31,#32,#33,#34,#35),$);\n`;
    fullIFC += `#37=IFCSTYLEDITEM(#36,(#18),$);\n`;
    fullIFC += `#38=IFCSHAPEREPRESENTATION(#3,'Body','Tessellation',(#36));\n`;
    fullIFC += `#39=IFCGEOGRAPHICELEMENT('2BqK1DRG16$faoJUdCgEAN',$,'Geomarker','Hier ist die Markierung der Georeferenzierung.','GIS',#13,#41,$,.TERRAIN.);\n`;
    fullIFC += `#40=IFCRELCONTAINEDINSPATIALSTRUCTURE('13VANNJ$rAAAWi5V_ENPge',$,$,$,(#39),#16);\n`;
    fullIFC += `#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#38));\n`;

    const faceMeshes = window.ifcMeshes.filter(mesh => !mesh.userData?.isCylinder);
    const faceMeshLookup = new Map(faceMeshes
        .filter(mesh => Number.isInteger(mesh.userData?.boreholeIndex) && Number.isInteger(mesh.userData?.layerIndex))
        .map(mesh => [`${mesh.userData.boreholeIndex}-${mesh.userData.layerIndex}`, mesh])
    );

    console.log('buildIfcExport: start', { selectedEpsg, boreholes: window.cardsData?.length, faceMeshes: faceMeshes.length });
    const _buildIfc_start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    let _processedBoreholes = 0;

    window.cardsData.forEach((borehole, boreholeIndex) => {
        if (boreholeIndex % 5 === 0 || boreholeIndex < 3) console.log(`buildIfcExport: processing borehole ${boreholeIndex + 1}/${window.cardsData.length}`);
        try {
            const siteId = getNextIfcEntityId();
            const relAggId = getNextIfcEntityId();
            const siteName = `${boreholeIndex + 1}. Bohrung`;
            const siteDescription = `Die ${boreholeIndex + 1}. Bohrung beinhaltet das ${boreholeIndex + 1}. Bohrloch mit Bohrpfeilern (gemessene Bohrsaeule) und Schichtvolumen (errechnete Ausdehnung)`;
            const boreholeCoords = borehole.coords || { lat: 51.45, lng: 14.20 };
            const boreholeLatDMS = decimalDegreesToIfcDMS(boreholeCoords.lat);
            const boreholeLonDMS = decimalDegreesToIfcDMS(boreholeCoords.lng);
            const boreholeNhn = typeof borehole.nhn === 'number' ? borehole.nhn : 0.0;

            // IFCSITE für diese Bohrung
            fullIFC += `#${siteId}=IFCSITE('${generateIFCGUID(siteId)}',$,'${siteName}','${siteDescription}',$,#13,$,$,.PARTIAL.,${boreholeLatDMS},${boreholeLonDMS},${boreholeNhn.toFixed(2)},$,$);\n`;
            fullIFC += `#${relAggId}=IFCRELAGGREGATES('${generateIFCGUID(relAggId)}',$,'Verbindung der Objekte RUMMZ und ${siteName}',$,#1,(#${siteId}));\n`;

            borehole.layers.forEach((layer, layerIndex) => {
                const key = `${boreholeIndex}-${layerIndex}`;
                const layerName = layer.name || `Schicht ${layerIndex + 1}`;
                const color = layer.color || '#dee2e6';
                const rgb = hexToRgb(color);
                const rgbString = rgb ? `${(rgb.r / 255).toFixed(1)},${(rgb.g / 255).toFixed(1)},${(rgb.b / 255).toFixed(1)}` : '0.5,0.5,0.5';

                // Style für diese Schicht
                const styleId = getNextIfcEntityId();
                const shadingId = getNextIfcEntityId();
                const colorId = getNextIfcEntityId();
                fullIFC += `#${styleId}=IFCSURFACESTYLE('${layerName}',.BOTH.,(#${shadingId}));\n`;
                fullIFC += `#${shadingId}=IFCSURFACESTYLESHADING(#${colorId},$);\n`;
                fullIFC += `#${colorId}=IFCCOLOURRGB($,${rgbString});\n`;

                // Bohrpfeiler (Box-Geometrie)
                const boxGeometries = generateIFCBoxSet([borehole], boxReference, layerIndex);
                if (boxGeometries.length > 0) {
                    const boxFaceSetId = boxGeometries[0].faceSetId;
                    fullIFC += boxGeometries[0].ifcOutput;

                    const shapeRepId = getNextIfcEntityId();
                    const geoElementId = getNextIfcEntityId();
                    const relContainedId = getNextIfcEntityId();
                    const productDefId = getNextIfcEntityId();
                    const styleItemId = getNextIfcEntityId();

                    fullIFC += `#${shapeRepId}=IFCSHAPEREPRESENTATION(#3,'Body','SurfaceModel',(#${boxFaceSetId}));\n`;
                    fullIFC += `#${geoElementId}=IFCGEOGRAPHICELEMENT('${generateIFCGUID(geoElementId)}',$,'${layerIndex + 1}. Bohrpfeiler','${layerName}','IfcBorehole',#13,#${productDefId},$,.TERRAIN.);\n`;
                    fullIFC += `#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateIFCGUID(relContainedId)}',$,$,$,(#${geoElementId}),#${siteId});\n`;
                    fullIFC += `#${productDefId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));\n`;
                    fullIFC += `#${styleItemId}=IFCSTYLEDITEM(#${boxFaceSetId},(#${styleId}),'${layerName}');\n`;

                    // Properties für Bohrpfeiler
                    const propIds = [];
                    const zTop = borehole.nhn;
                    const zBottom = borehole.nhn - (layer.height / 100);
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Oberkante der gemessenen NHN in Meter',$,IFCREAL(${zTop.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Unterkante der gemessenen NHN in Meter',$,IFCREAL(${zBottom.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Maechtigkeit in cm',$,IFCINTEGER(${layer.height || 0}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Substanz',$,IFCTEXT('${layerName}'),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Farbe als Hex-Wert',$,IFCTEXT('${rgbString}'),$);\n`;
                    // Grundfläche und Volumen für Bohrpfeiler (1x1m Box)
                    const boxArea = 1.0; // 1m x 1m = 1 m²
                    const boxVolume = boxArea * (layer.height / 100); // 1 m² × Tiefe in Metern
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Grundflaeche in m2',$,IFCREAL(${boxArea.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Volumen in m3',$,IFCREAL(${boxVolume.toFixed(2)}),$);\n`;

                    const propSetId = getNextIfcEntityId();
                    fullIFC += `#${propSetId}=IFCPROPERTYSET('${generateIFCGUID(propSetId)}',$,'Eigenschaften des ${boreholeIndex + 1}. Bohrpfeilers',$,(${propIds.map(id => `#${id}`).join(',')}));\n`;
                    const relPropId = getNextIfcEntityId();
                    fullIFC += `#${relPropId}=IFCRELDEFINESBYPROPERTIES('${generateIFCGUID(relPropId)}',$,$,$,(#${geoElementId}),#${propSetId});\n`;
                }

                // Schichtvolumen (Face-Mesh)
                const mesh = faceMeshLookup.get(key);
                if (mesh) {
                    const ifcData = generateIFCFaceSet(mesh, window.ifcOrigin);
                    const faceSetId = ifcData.faceSetId;
                    fullIFC += ifcData.ifcOutput;

                    const shapeRepId = getNextIfcEntityId();
                    const geoElementId = getNextIfcEntityId();
                    const relContainedId = getNextIfcEntityId();
                    const productDefId = getNextIfcEntityId();
                    const styleItemId = getNextIfcEntityId();

                    fullIFC += `#${shapeRepId}=IFCSHAPEREPRESENTATION(#3,'Body','SurfaceModel',(#${faceSetId}));\n`;
                    fullIFC += `#${geoElementId}=IFCGEOGRAPHICELEMENT('${generateIFCGUID(geoElementId)}',$,'${layerIndex + 1}. Schichtvolumen','${layerName}','IfcGeotechnicalStratum',#13,#${productDefId},$,.TERRAIN.);\n`;
                    fullIFC += `#${relContainedId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateIFCGUID(relContainedId)}',$,$,$,(#${geoElementId}),#${siteId});\n`;
                    fullIFC += `#${productDefId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));\n`;
                    fullIFC += `#${styleItemId}=IFCSTYLEDITEM(#${faceSetId},(#${styleId}),'${layerName}');\n`;

                    // Properties für Schichtvolumen (vereinfacht, da Volumenberechnung komplex ist)
                    const propIds = [];
                    const zTop = borehole.nhn;
                    const zBottom = borehole.nhn - (layer.height / 100);
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Oberkante der gemessenen NHN in Meter',$,IFCREAL(${zTop.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('z-Wert Unterkante der gemessenen NHN in Meter',$,IFCREAL(${zBottom.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Maechtigkeit in cm',$,IFCINTEGER(${layer.height || 0}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Substanz',$,IFCTEXT('${layerName}'),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Farbe als Hex-Wert',$,IFCTEXT('${rgbString}'),$);\n`;
                    // Grundfläche und Volumen aus mesh.userData
                    const layerArea = mesh.userData?.layerArea || 0;
                    const layerVolume = mesh.userData?.layerVolume || 0;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Grundflaeche in m2',$,IFCREAL(${layerArea.toFixed(2)}),$);\n`;
                    propIds.push(getNextIfcEntityId());
                    fullIFC += `#${propIds[propIds.length - 1]}=IFCPROPERTYSINGLEVALUE('Volumen in m3',$,IFCREAL(${layerVolume.toFixed(2)}),$);\n`;

                    const propSetId = getNextIfcEntityId();
                    fullIFC += `#${propSetId}=IFCPROPERTYSET('${generateIFCGUID(propSetId)}',$,'Eigenschaften des ${boreholeIndex + 1}. Schichtvolumens',$,(${propIds.map(id => `#${id}`).join(',')}));\n`;
                    const relPropId = getNextIfcEntityId();
                    fullIFC += `#${relPropId}=IFCRELDEFINESBYPROPERTIES('${generateIFCGUID(relPropId)}',$,$,$,(#${geoElementId}),#${propSetId});\n`;
                }
            });
            _processedBoreholes++;
        } catch (err) {
            console.error(`buildIfcExport: error processing borehole ${boreholeIndex}`, err);
            throw err;
        }
    });

    const _buildIfc_end = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    console.log(`buildIfcExport: completed in ${( _buildIfc_end - _buildIfc_start).toFixed(1)} ms, processed ${_processedBoreholes} boreholes, ifc length ${fullIFC.length}`);

    return fullIFC;
}

// IFC-Download (Dashboard IFC button)
async function performIfcExport() {
    console.log('performIfcExport: started', { ifcMeshesLength: window.ifcMeshes?.length });
    const btnEl = document.getElementById('btn-toggle-elements');
    if (btnEl) btnEl.disabled = true;
    try {
        // If IFC meshes are not yet present, trigger visualisation build and wait briefly
        if (!window.ifcMeshes || window.ifcMeshes.length === 0) {
            console.log('performIfcExport: no ifcMeshes found, triggering visualisation build');
            try {
                triggerVisualisationUpdate();
            } catch (e) {
                console.warn('performIfcExport: triggerVisualisationUpdate failed', e);
            }

            // Wait up to 5s for window.ifcMeshes to be populated
            const start = Date.now();
            const timeout = 5000;
            while ((!window.ifcMeshes || window.ifcMeshes.length === 0) && (Date.now() - start) < timeout) {
                // yield to event loop
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r => setTimeout(r, 150));
            }
            console.log('performIfcExport: wait complete, ifcMeshesLength now', window.ifcMeshes?.length || 0);
            if (!window.ifcMeshes || window.ifcMeshes.length === 0) {
                alert('Keine IFC-Geometrien verfügbar. Bitte zuerst die Visualisierung laden oder warte einen Moment.');
                return;
            }
        }
        
        // proceed with IFC module import and build
        const { generateIFCFaceSet, generateIFCBoxSet, resetIfcEntityId, getNextIfcEntityId } = await import('./ifc.js');
        console.log('performIfcExport: ifc module imported');
        resetIfcEntityId(); // Reset IFC entity IDs
        let fullIFC = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'ViewDefinition [DesignTransferView]\'), \'2;1\');\nFILE_NAME(\'rummz.ifc\',\'2025-01-01T12:00:00\',(\'Author\'),(\'Organization\'),\'IFC4\',\'RUMMZ-Version-1-Prototyp\',\'Generated by RUMMZ\');\nFILE_SCHEMA((\'IFC4\'));\nENDSEC;\nDATA;\n';
        const boxReference = window.cardsData && window.cardsData.length > 0 ? window.cardsData[0] : null;
        const selectedEpsg = document.getElementById('dashboard-ifc-epsg')?.value || dashboardSelectedEPSG || '4326';
        // buildIfcExport may be CPU/memory heavy for large datasets; log progress
        console.log('performIfcExport: calling buildIfcExport', { boreholes: window.cardsData?.length });
        fullIFC = buildIfcExport(fullIFC, boxReference, generateIFCFaceSet, generateIFCBoxSet, getNextIfcEntityId, selectedEpsg);
        fullIFC += 'ENDSEC;\nEND-ISO-10303-21;\n';
        const blob = new Blob([fullIFC], { type: 'text/plain' });
        const projectTitleInput = document.getElementById('dashboard-project-title');
        const baseName = projectTitleInput && projectTitleInput.value.trim() ? projectTitleInput.value.trim().replace(/[^\w\-]+/g,'_') : 'rummz_model';
        const fileName = `${baseName}.ifc`;

        if (navigator.msSaveBlob) {
            navigator.msSaveBlob(blob, fileName);
            console.log('performIfcExport: msSaveBlob fallback used');
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.target = '_blank';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
            if (!a.dispatchEvent(clickEvent)) {
                console.warn('performIfcExport: download click event was canceled');
            }
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        console.log('performIfcExport: finished and download triggered', { fileName });
        alert(`IFC-Download wurde gestartet: ${fileName}`);
    } catch (err) {
        console.error('IFC export failed:', err);
        alert('IFC-Export fehlgeschlagen. Konsole prüfen.');
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

// Attach handler via delegation so the listener survives UI re-renders
// This avoids losing the handler if the dashboard section is recreated after loading boreholes.
document.addEventListener('click', (e) => {
    try {
        const target = e.target;
        if (target && (target.id === 'btn-toggle-elements' || (target.closest && target.closest('#btn-toggle-elements')))) {
            console.log('btn-toggle-elements clicked (delegated)');
            performIfcExport();
        }
    } catch (err) {
        console.error('Delegated IFC click handler error:', err);
    }
});

// Project title input handler
document.getElementById('dashboard-project-title').addEventListener('input', (e) => {
    projectTitle = e.target.value;
});