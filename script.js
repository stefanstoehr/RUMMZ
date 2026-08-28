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
let mapMarkerInstances = {};
const gridContent = document.querySelector('.grid-content');
let projectTitle = '';
let lastSelectedEPSG = '4326';
let dashboardSelectedEPSG = lastSelectedEPSG;
let ifcOverlayRequestId = 0;
const defaultVisualControls = {
    boreholeDiameter: 0,
    transparency: 0,
    boundingbox: 0,
    layerThickness: 0,
    layerSpacing: 0
};

const multiplierSequence = [1, 5, 10, 15, 20, 25];

const visualControlConfig = {
    boreholeDiameter: {
        min: 0,
        max: multiplierSequence.length - 1,
        step: 1,
        format: (value) => `x${multiplierSequence[value] ?? 1}`
    },
    transparency: {
        min: 0,
        max: 100,
        step: 1,
        format: (value) => `${value}%`
    },
    boundingbox: {
        min: 0,
        max: 100,
        step: 1,
        format: (value) => {
            if (value <= 5) return 'max.';
            if (value >= 95) return 'min.';
            return `${value}%`;
        }
    },
    layerThickness: {
        min: 0,
        max: multiplierSequence.length - 1,
        step: 1,
        format: (value) => `x${multiplierSequence[value] ?? 1}`
    },
    layerSpacing: {
        min: 0,
        max: 25,
        step: 5,
        format: (value) => `${value} m`
    }
};

window.rummzVisualControls = Object.assign({}, defaultVisualControls, window.rummzVisualControls || {});
window.userLocationVisible = window.userLocationVisible === true;
window.userLocationData = window.userLocationData || null;
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
        const landingImage = overlay.querySelector('.landing-image');
        const hideAfterLandingImageReady = () => {
            if (landingImage) {
                landingImage.classList.remove('landing-image--pending');
            }

            // Keep the landing image visible for 3.5 seconds after it is ready.
            setTimeout(() => {
            overlay.classList.add('fade-out');
            // Remove from DOM after animation completes
            setTimeout(() => {
                overlay.remove();
            }, 500);
            }, 3000);
        };

        if (!landingImage || (landingImage.complete && landingImage.naturalWidth > 0)) {
            hideAfterLandingImageReady();
            return;
        }

        landingImage.addEventListener('load', async () => {
            if (typeof landingImage.decode === 'function') {
                try {
                    await landingImage.decode();
                } catch (error) {
                    // The load event still confirms that the image is usable.
                }
            }
            hideAfterLandingImageReady();
        }, { once: true });
        landingImage.addEventListener('error', hideAfterLandingImageReady, { once: true });
    }
}

function showIfcDownloadOverlay() {
    ifcOverlayRequestId += 1;
    const requestId = ifcOverlayRequestId;

    const existingOverlay = document.getElementById('ifc-download-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const preloadImage = new Image();
    const timeoutId = setTimeout(() => {
        preloadImage.onload = null;
        preloadImage.onerror = null;
    }, 3000);

    preloadImage.onload = () => {
        clearTimeout(timeoutId);
        if (requestId !== ifcOverlayRequestId) return;

        const overlay = document.createElement('div');
        overlay.id = 'ifc-download-overlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <img src="assets/cartoon-ende.png" alt="IFC Download gestartet" class="landing-image">
            </div>
        `;

        document.body.appendChild(overlay);

        // Keep the download image fully visible for at least 3 seconds before fading out.
        const MIN_VISIBLE_MS = 3000;
        const FADE_OUT_MS = 500;
        setTimeout(() => {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.remove();
            }, FADE_OUT_MS);
        }, MIN_VISIBLE_MS);
    };

    preloadImage.onerror = () => {
        clearTimeout(timeoutId);
    };

    preloadImage.src = 'assets/cartoon-ende.png';
}

/**
 * Shows a full-screen waiting overlay while a long-running synchronous
 * task (e.g. rebuilding all cards/maps after a JSON import) is in progress.
 * The image is preloaded on page load (see index.html), so it is already
 * cached by the browser and renders instantly here.
 */
function showWaitOverlay() {
    const existingOverlay = document.getElementById('wait-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'wait-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading-content">
            <img src="assets/cartoon-warten.png" alt="Bitte warten" class="landing-image">
            <div class="loading-spinner">
                <div class="spinner"></div>
            </div>
        </div>
    `;
    // Record the show time so hideWaitOverlay() can enforce a minimum visibility of 3 s.
    overlay.dataset.shownAt = String(Date.now());
    document.body.appendChild(overlay);
}

/**
 * Hides the waiting overlay shown by showWaitOverlay().
 * The overlay stays fully visible for at least 3 seconds before fading out.
 */
function hideWaitOverlay() {
    const overlay = document.getElementById('wait-overlay');
    if (!overlay || overlay.dataset.fadeStarted === 'true') return;

    const MIN_VISIBLE_MS = 3000;
    const FADE_OUT_MS = 500;
    const shownAt = Number.parseInt(overlay.dataset.shownAt || '0', 10);
    const elapsed = Number.isFinite(shownAt) && shownAt > 0 ? Date.now() - shownAt : MIN_VISIBLE_MS;
    const remainingMs = Math.max(0, MIN_VISIBLE_MS - elapsed);

    overlay.dataset.fadeStarted = 'true';
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), FADE_OUT_MS);
    }, remainingMs);
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
        color: '#000000' // Default color
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
    syncAllCardMarkers();

    const map = mapInstances[card.id];
    if (!map || !card.coords) return;

    if (options.centerMap === true) {
        map.setView(card.coords, map.getZoom());
    }
}

function syncAllCardMarkers() {
    cardsData.forEach(syncMapMarkers);
}

function syncMapMarkers(mapCard) {
    const map = mapInstances[mapCard.id];
    if (!map || typeof L === 'undefined') return;

    const mapMarkers = mapMarkerInstances[mapCard.id] || {};
    const boreholeIdsWithCoords = new Set();

    cardsData.forEach((borehole, index) => {
        if (!borehole.coords) return;

        boreholeIdsWithCoords.add(borehole.id);
        const isCurrentCard = borehole.id === mapCard.id;
        let marker = mapMarkers[borehole.id];

        if (!marker) {
            marker = L.marker(borehole.coords, { draggable: isCurrentCard }).addTo(map);
            if (!isCurrentCard) {
                marker.getElement()?.classList.add('borehole-marker--ghost');
            }
            marker.bindTooltip(String(index + 1), {
                permanent: true,
                direction: 'center',
                offset: [-15, 1],
                className: `borehole-marker-label${isCurrentCard ? '' : ' borehole-marker-label--ghost'}`
            });

            if (isCurrentCard) {
                marker.on('drag', function(e) {
                    const newCoords = e.target.getLatLng();
                    borehole.coords = newCoords;
                    clearCoordsInputError(borehole.id);
                    updateCoordsInputs(borehole.id, newCoords);
                    syncAllCardMarkers();
                });
                marker.on('dragend', function() {
                    triggerVisualisationUpdate();
                });
                markerInstances[borehole.id] = marker;
            }
            mapMarkers[borehole.id] = marker;
        } else {
            marker.setLatLng(borehole.coords);
            marker.setTooltipContent(String(index + 1));
        }
    });

    Object.entries(mapMarkers).forEach(([boreholeId, marker]) => {
        if (!boreholeIdsWithCoords.has(boreholeId)) {
            map.removeLayer(marker);
            delete mapMarkers[boreholeId];
        }
    });

    mapMarkerInstances[mapCard.id] = mapMarkers;
}

function clearCardCoords(card) {
    card.coords = null;
    syncAllCardMarkers();
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
    updateUICardControls();
    window.dispatchEvent(new CustomEvent('updateVisualisation', {
        detail: {
            cardsData: cardsData,
            visualControls: window.rummzVisualControls
        }
    }));
}

function clampSliderValue(value, min, max, step) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return min;
    const clamped = Math.max(min, Math.min(max, parsed));
    if (!step || step <= 0) return clamped;
    const snapped = Math.round((clamped - min) / step) * step + min;
    return Math.max(min, Math.min(max, snapped));
}

function setVisualControlValue(controlName, value) {
    if (!window.rummzVisualControls || typeof window.rummzVisualControls !== 'object') {
        window.rummzVisualControls = Object.assign({}, defaultVisualControls);
    }

    const config = visualControlConfig[controlName];
    if (!config) return;

    window.rummzVisualControls[controlName] = clampSliderValue(value, config.min, config.max, config.step);
}

function updateDashboardFaderValueLabel(faderSection, sliderId, controlName, value) {
    const valueLabel = faderSection.querySelector(`[data-fader-value-for="${sliderId}"]`);
    if (!valueLabel) return;

    const config = visualControlConfig[controlName];
    if (!config) return;

    valueLabel.textContent = config.format(value);
}

function bindDashboardFaderControls(faderSection) {
    if (!faderSection) return;

    const controlBindings = [
        { id: 'fader-borehole-diameter', control: 'boreholeDiameter' },
        { id: 'fader-transparency', control: 'transparency' },
        { id: 'fader-boundingbox', control: 'boundingbox' },
        { id: 'fader-layer-thickness', control: 'layerThickness' },
        { id: 'fader-layer-spacing', control: 'layerSpacing' }
    ];

    controlBindings.forEach(({ id, control }) => {
        const slider = faderSection.querySelector(`#${id}`);
        if (!slider) return;

        const config = visualControlConfig[control];
        if (!config) return;

        slider.min = String(config.min);
        slider.max = String(config.max);
        slider.step = String(config.step);

        const currentValue = window.rummzVisualControls?.[control];
        const safeValue = clampSliderValue(currentValue, config.min, config.max, config.step);
        slider.value = String(safeValue);
        setVisualControlValue(control, safeValue);
        updateDashboardFaderValueLabel(faderSection, id, control, safeValue);

        const applyValue = () => {
            setVisualControlValue(control, slider.value);
            updateDashboardFaderValueLabel(faderSection, id, control, window.rummzVisualControls[control]);
            triggerVisualisationUpdate();
        };

        slider.addEventListener('input', applyValue);
        slider.addEventListener('change', applyValue);
    });
}

function setDashboardUserLocation(toggleBtn, visible) {
    const isVisible = visible === true;
    window.userLocationVisible = isVisible;
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('active', isVisible);
    // Keep a stable icon class to avoid layout shifts when toggling state.
    toggleBtn.classList.add('bi-crosshair');
    toggleBtn.classList.remove('bi-crosshair-fill');
    toggleBtn.setAttribute('aria-pressed', String(isVisible));
}

function requestCurrentUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
            reject(new Error('Geolocation API ist in diesem Browser nicht verfuegbar.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
                    timestamp: position.timestamp || Date.now()
                });
            },
            (error) => {
                let message = 'Standort konnte nicht bestimmt werden.';
                if (error && typeof error.code === 'number') {
                    if (error.code === 1) message = 'Standortfreigabe wurde verweigert.';
                    if (error.code === 2) message = 'Standort ist aktuell nicht verfuegbar.';
                    if (error.code === 3) message = 'Standortabfrage hat zu lange gedauert.';
                }
                reject(new Error(message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000
            }
        );
    });
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

function isRenderableLayer(layer) {
    return !!layer
        && typeof layer.name === 'string'
        && layer.name.trim() !== ''
        && typeof layer.height === 'number'
        && layer.height > 0
        && typeof layer.color === 'string'
        && layer.color.trim() !== '';
}

function hasRenderableCardCore(card) {
    return !!card
        && typeof card.nhn === 'number'
        && !!card.coords
        && typeof card.coords === 'object'
        && typeof card.coords.lat === 'number'
        && typeof card.coords.lng === 'number';
}

function getCardRenderStatus(card) {
    const layers = Array.isArray(card?.layers) ? card.layers : [];
    const renderableLayersCount = layers.filter(isRenderableLayer).length;
    const hasRenderableCoreData = hasRenderableCardCore(card);

    if (hasRenderableCoreData && layers.length > 0 && renderableLayersCount === layers.length) {
        return {
            state: 'full',
            iconClass: 'bi-database-fill-check',
            label: 'Alles renderbar'
        };
    }

    if (hasRenderableCoreData && renderableLayersCount > 0) {
        return {
            state: 'partial',
            iconClass: 'bi-database-fill-dash',
            label: `Teilweise renderbar: ${renderableLayersCount} von ${layers.length} Schichten sichtbar`
        };
    }

    return {
        state: 'none',
        iconClass: 'bi-database-fill-exclamation',
        label: 'Noch nicht renderbar'
    };
}

function getCardTitleMarkup(card, index, totalCards) {
    const status = getCardRenderStatus(card);
    return `<i class="bi ${status.iconClass} card-render-status card-render-status--${status.state}" role="img" aria-label="${escapeHtml(status.label)}" title="${escapeHtml(status.label)}"></i>Bohrung ${index + 1} <span class="card-title-total">von ${totalCards}</span>`;
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
    const baseNhn = (typeof card.nhn === 'number') ? card.nhn : 0;
    const topBoundaryText = `NHN: ${baseNhn.toFixed(2)} m | Tiefe: 0.00 m`;

    const topSeparatorDiv = document.createElement('div');
    topSeparatorDiv.className = 'layer-separator layer-separator-top';
    topSeparatorDiv.innerHTML = `
            <div class="layer-separator-content">
                <div class="layer-separator-metric" aria-live="polite">${topBoundaryText}</div>
                <button class="add-layer-btn" aria-label="Schicht hier einfügen" data-card-id="${card.id}" data-layer-index="-1"><i class="bi bi-plus-circle" aria-hidden="true"></i></button>
            </div>
        `;
    fragment.appendChild(topSeparatorDiv);

    card.layers.forEach((layer, layerIndex) => {
        const layerDiv = document.createElement('div');
        layerDiv.className = 'card-layer';
        layerDiv.id = layer.id;
        const layerColor = layer.color || '#000000';
        layerDiv.style.borderLeftColor = layerColor;
        const heightInCm = (typeof layer.height === 'number') ? layer.height : '';
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
                        <button type="button" class="color-picker-plus" aria-label="Eigene Farbe auswählen" title="Eigene Farbe auswählen" style="color:${layerColor}; border-color:${layerColor};">
                            +
                            <input type="color" class="layer-color-picker"
                                   data-card-id="${card.id}" data-layer-id="${layer.id}" value="${layerColor}" aria-label="Schichtfarbe wählen">
                        </button>
                        <div class="color-swatch-row" role="list" aria-label="Vordefinierte Farben">
                            ${predefinedColors.map(({ name, value }) => `
                                <button type="button" class="color-swatch" data-card-id="${card.id}" data-layer-id="${layer.id}" data-color="${value}" style="background-color:${value}" title="${name}" aria-label="Farbe ${name}"></button>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <button class="delete-layer-btn ${card.layers.length <= 1 ? 'invisible' : ''}" aria-label="Schicht löschen" data-card-id="${card.id}" data-layer-id="${layer.id}"><i class="bi bi-x-circle" aria-hidden="true"></i></button>
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
            <div class="layer-separator-content">
                <div class="layer-separator-metric" aria-live="polite">${boundaryText}</div>
                <button class="add-layer-btn" aria-label="Schicht hier einfügen" data-card-id="${card.id}" data-layer-index="${layerIndex}"><i class="bi bi-plus-circle" aria-hidden="true"></i></button>
            </div>
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

    const topSeparatorMetric = layersContainer.querySelector('.layer-separator-top .layer-separator-metric');
    if (topSeparatorMetric) {
        topSeparatorMetric.textContent = `NHN: ${baseNhn.toFixed(2)} m | Tiefe: 0.00 m`;
    }

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
        <div class="card-title">${getCardTitleMarkup(card, index, cardsData.length || 1)}</div>
        <button class="delete-card-btn" aria-label="Bohrung löschen" data-card-id="${card.id}"><i class="bi bi-x-circle" aria-hidden="true"></i></button>
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
            const card = cardsData[index];
            title.innerHTML = getCardTitleMarkup(card, index, totalCards);
            const marker = markerInstances[card.id];
            if (marker) {
                marker.setTooltipContent(String(index + 1));
            }
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
            <button type="button" class="hide-info-btn" aria-label="Guide ausblenden"><i class="bi bi-x-circle" aria-hidden="true"></i></button>
        </div>
        <div class="card-details" style="display: block; padding: 1.25rem; font-size: 0.95rem; line-height: 1.6;">
            <div class="card-title"><i class="bi bi-1-circle-fill" style="margin-right: 0.5rem;"></i>Hinweise</div>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
                <li style="margin-bottom: 0.75rem; display: flex; align-items: flex-start;">
                    <i class="bi bi-exclamation-triangle" style="margin-right: 0.5rem; font-size: 1.2em;"></i>
                    <div id="guide">
                        <span>RUMMZ 1 ist ein Prototyp (MVP). Wenn Sie Kunde oder Partner werden möchten, schreiben Sie an dev@rummz.de.</span>
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
                <button type="button" class="map-icon-btn bi bi-database" title="Bohrzylinder" aria-label="Bohrzylinder"></button>
                <button type="button" class="map-icon-btn bi bi-box" title="Ausbreitungsgeometrie" aria-label="Ausbreitungsgeometrie"></button>
                <button type="button" class="map-icon-btn bi bi-geo-alt" title="Bohrort" aria-label="Bohrort"></button>
                <button type="button" class="map-icon-btn bi bi-triangle" title="Höhenstruktur" aria-label="Höhenstruktur"></button>
                <button type="button" class="map-icon-btn bi bi-map" title="Topografie" aria-label="Topografie"></button>
                <button type="button" class="map-icon-btn bi bi-crosshair" title="Dein Standort" aria-label="Dein Standort"></button>
                <button type="button" class="map-icon-btn bi bi-arrows-angle-contract" title="Ansicht zurücksetzen" aria-label="Ansicht zurücksetzen"></button>
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

    const cylinderToggle = mapDiv.querySelector('.map-icon-stack .bi-database');
    if (cylinderToggle) {
        const isCylinderVisible = window.boreholeCylindersVisible !== false;
        cylinderToggle.classList.toggle('active', isCylinderVisible);
        cylinderToggle.setAttribute('aria-pressed', String(isCylinderVisible));
        cylinderToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isActive = cylinderToggle.classList.toggle('active');
            cylinderToggle.setAttribute('aria-pressed', String(isActive));
            window.dispatchEvent(new CustomEvent('toggleBoreholeCylinders', { detail: { visible: isActive } }));
        });
    }

    const volumeToggle = mapDiv.querySelector('.map-icon-stack .bi-box');
    if (volumeToggle) {
        const isVolumeVisible = window.spreadVolumesVisible !== false;
        volumeToggle.classList.toggle('active', isVolumeVisible);
        volumeToggle.setAttribute('aria-pressed', String(isVolumeVisible));
        volumeToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isActive = volumeToggle.classList.toggle('active');
            volumeToggle.setAttribute('aria-pressed', String(isActive));
            window.dispatchEvent(new CustomEvent('toggleSpreadVolumes', { detail: { visible: isActive } }));
        });
    }

    const geoToggle = mapDiv.querySelector('.map-icon-stack .bi-geo-alt');
    if (geoToggle) {
        geoToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isActive = geoToggle.classList.toggle('active');
            geoToggle.setAttribute('aria-pressed', String(isActive));
            window.dispatchEvent(new CustomEvent('toggleBoreholeMarkers', { detail: { visible: isActive } }));
        });
    }

    const topographyToggle = mapDiv.querySelector('.map-icon-stack .bi-map');
    if (topographyToggle) {
        const isTopographyVisible = window.topographyVisible === true;
        topographyToggle.classList.toggle('active', isTopographyVisible);
        topographyToggle.setAttribute('aria-pressed', String(isTopographyVisible));
        topographyToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isActive = topographyToggle.classList.toggle('active');
            topographyToggle.setAttribute('aria-pressed', String(isActive));
            window.dispatchEvent(new CustomEvent('toggleTopography', { detail: { visible: isActive } }));
        });
    }

    const surfaceToggle = mapDiv.querySelector('.map-icon-stack .bi-triangle');
    if (surfaceToggle) {
        const isDgmActive = window.rummzVisualisationMode === 'dgm';
        surfaceToggle.classList.toggle('active', isDgmActive);
        surfaceToggle.setAttribute('aria-pressed', String(isDgmActive));

        surfaceToggle.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const previousMode = window.rummzVisualisationMode || 'plane';
            const nextMode = previousMode === 'plane' ? 'dgm' : 'plane';
            window.dispatchEvent(new CustomEvent('switchVisualisationMode', { detail: { previousMode } }));
            window.rummzVisualisationMode = nextMode;

            if (nextMode === 'dgm') {
                await import('./three-dgm.js');
            }

            const isActive = nextMode === 'dgm';
            surfaceToggle.classList.toggle('active', isActive);
            surfaceToggle.setAttribute('aria-pressed', String(isActive));
            triggerVisualisationUpdate();
        });
    }

    const userLocationToggle = mapDiv.querySelector('.map-icon-stack .bi-crosshair, .map-icon-stack .bi-crosshair-fill');
    if (userLocationToggle) {
        setDashboardUserLocation(userLocationToggle, window.userLocationVisible === true);

        userLocationToggle.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const wasActive = userLocationToggle.classList.contains('active');
            if (wasActive) {
                setDashboardUserLocation(userLocationToggle, false);
                window.dispatchEvent(new CustomEvent('toggleUserLocation', { detail: { visible: false } }));
                return;
            }

            userLocationToggle.disabled = true;
            userLocationToggle.classList.add('is-loading');
            try {
                const locationData = await requestCurrentUserLocation();
                window.userLocationData = locationData;
                setDashboardUserLocation(userLocationToggle, true);
                window.dispatchEvent(new CustomEvent('updateUserLocation', { detail: locationData }));
                window.dispatchEvent(new CustomEvent('toggleUserLocation', { detail: { visible: true } }));
            } catch (error) {
                setDashboardUserLocation(userLocationToggle, false);
                window.dispatchEvent(new CustomEvent('toggleUserLocation', { detail: { visible: false } }));
                alert(error instanceof Error ? error.message : 'Standort konnte nicht bestimmt werden.');
            } finally {
                userLocationToggle.disabled = false;
                userLocationToggle.classList.remove('is-loading');
            }
        });
    }

    const resetViewToggle = mapDiv.querySelector('.map-icon-stack .bi-arrows-angle-contract');
    if (resetViewToggle) {
        resetViewToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('resetVisualisationView'));
            triggerVisualisationUpdate();
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

    // FADER-SECTION

    const faderDiv = document.createElement('div');
    faderDiv.className = 'card-location fader-section';
    faderDiv.innerHTML = `
        <button type="button" class="dashboard-settings-toggle" aria-expanded="false" aria-controls="dashboard-settings-content" aria-label="Einstellungen aufklappen">
            <span class="dashboard-settings-toggle-content">
                <span class="dashboard-settings-triangle" aria-hidden="true">▸</span>
                <span class="layer-separator-metric">Einstellungen</span>
            </span>
        </button>
        <div id="dashboard-settings-content" class="fader-section-content" hidden>
            <div class="location-input-group">
                <label for="fader-borehole-diameter">Bohrungsdurchmesser</label>
                <div class="fader-control-row">
                    <input type="range" id="fader-borehole-diameter" name="fader-borehole-diameter">
                    <span class="fader-value" data-fader-value-for="fader-borehole-diameter">x1</span>
                </div>
            </div>
            <div class="location-input-group">
                <label for="fader-transparency">Transparenz</label>
                <div class="fader-control-row">
                    <input type="range" id="fader-transparency" name="fader-transparency">
                    <span class="fader-value" data-fader-value-for="fader-transparency">0%</span>
                </div>
            </div>
            <div class="location-input-group">
                <label for="fader-boundingbox">Boundingbox</label>
                <div class="fader-control-row">
                    <input type="range" id="fader-boundingbox" name="fader-boundingbox">
                    <span class="fader-value" data-fader-value-for="fader-boundingbox">max.</span>
                </div>
            </div>
            <div class="location-input-group">
                <label for="fader-layer-thickness">Schichtmächtigkeit</label>
                <div class="fader-control-row">
                    <input type="range" id="fader-layer-thickness" name="fader-layer-thickness">
                    <span class="fader-value" data-fader-value-for="fader-layer-thickness">x1</span>
                </div>
            </div>
            <div class="location-input-group">
                <label for="fader-layer-spacing">Schichtabstand</label>
                <div class="fader-control-row">
                    <input type="range" id="fader-layer-spacing" name="fader-layer-spacing">
                    <span class="fader-value" data-fader-value-for="fader-layer-spacing">0 m</span>
                </div>
            </div>
        </div>
    `;

    previewDiv.appendChild(faderDiv);
    const settingsToggle = faderDiv.querySelector('.dashboard-settings-toggle');
    const settingsContent = faderDiv.querySelector('.fader-section-content');
    if (settingsToggle && settingsContent) {
        settingsToggle.addEventListener('click', () => {
            const shouldOpen = settingsContent.hidden;
            settingsContent.hidden = !shouldOpen;
            settingsToggle.setAttribute('aria-expanded', String(shouldOpen));
            settingsToggle.setAttribute('aria-label', shouldOpen ? 'Einstellungen zuklappen' : 'Einstellungen aufklappen');
            faderDiv.classList.toggle('is-open', shouldOpen);
        });
    }
    bindDashboardFaderControls(faderDiv);
    
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

// Click helpers: UI overlays/menus without data mutations.

function handleLayerNameMenuClick(event, target) {
    const layerNameCloseBtn = target.closest('.layername-menu-close');
    if (layerNameCloseBtn) {
        event.preventDefault();
        event.stopPropagation();
        const layerGroup = layerNameCloseBtn.closest('.layername-input-group');
        if (layerGroup) hideLayerNameMenu(layerGroup);
        return true;
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
        return true;
    }

    return false;
}

function handleCoordTooltipClick(event, target) {
    const closeBtn = target.closest('.coord-tooltip-close');
    if (closeBtn) {
        event.preventDefault();
        event.stopPropagation();
        const tooltip = closeBtn.closest('.coord-tooltip');
        if (tooltip) {
            tooltip.classList.remove('is-visible');
            tooltip.classList.add('coord-tooltip-dismissed');
        }
        return true;
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
        return true;
    }

    return false;
}

function handleColorSwatchClick(event, target) {
    const swatch = target.closest('.color-swatch');
    if (!swatch) return false;

    event.preventDefault();
    event.stopPropagation();

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

    return true;
}

function handleHideInfoClick(target) {
    if (!target.closest('.hide-info-btn')) return false;

    const infoCard = document.querySelector('.info');
    if (infoCard) {
        infoCard.classList.add('info-hidden');
    }
    return true;
}

// Click helpers: card/layer data mutations.

function handleAddCardClick(target) {
    if (!target.matches('.add-card-btn')) return false;

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
    syncAllCardMarkers();
    updateUICardControls();
    triggerVisualisationUpdate();

    setTimeout(() => {
        gridContent.classList.remove('grid-is-adding');
    }, 0);

    return true;
}

function handleDeleteCardClick(target) {
    const deleteCardBtn = target.closest('.delete-card-btn');
    if (!deleteCardBtn) return false;

    const cardId = deleteCardBtn.dataset.cardId;
    if (cardsData.length <= 1) return true;

    const cardElem = document.getElementById(cardId);
    if (!cardElem) return true;
    const precedingAddBtn = cardElem.previousElementSibling;

    cardElem.classList.add('fade-out');
    if (precedingAddBtn && precedingAddBtn.matches('.add-card-btn')) {
        precedingAddBtn.classList.add('fade-out');
    }

    setTimeout(() => {
        const cardIndex = cardsData.findIndex(c => c.id === cardId);
        if (cardIndex > -1) {
            if (mapInstances[cardId]) {
                mapInstances[cardId].remove();
                delete mapInstances[cardId];
            }
            delete mapMarkerInstances[cardId];
            delete markerInstances[cardId];
            cardsData.splice(cardIndex, 1);
            if (cardElem) cardElem.remove();
            if (precedingAddBtn && precedingAddBtn.matches('.add-card-btn')) {
                precedingAddBtn.remove();
            }
            syncAllCardMarkers();
            updateUICardControls();
            triggerVisualisationUpdate();
        }
    }, 300);

    return true;
}

function handleAddLayerClick(target) {
    const addLayerBtn = target.closest('.add-layer-btn');
    if (!addLayerBtn) return false;

    const cardId = addLayerBtn.dataset.cardId;
    const card = cardsData.find(c => c.id === cardId);
    if (!card) return true;

    const layerIndex = parseInt(addLayerBtn.dataset.layerIndex, 10);
    const newLayer = createNewLayer(card.id, card.layers.length + 1);
    card.layers.splice(layerIndex + 1, 0, newLayer);

    const cardElem = document.getElementById(cardId);
    if (!cardElem) return true;
    const layersContainer = cardElem.querySelector('.layers-container');
    if (!layersContainer) return true;
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
    return true;
}

function handleDeleteLayerClick(target) {
    const deleteLayerBtn = target.closest('.delete-layer-btn');
    if (!deleteLayerBtn) return false;

    const cardId = deleteLayerBtn.dataset.cardId;
    const layerId = deleteLayerBtn.dataset.layerId;
    const card = cardsData.find(c => c.id === cardId);

    if (card && card.layers.length > 1) {
        const layerElem = document.getElementById(layerId);
        if (!layerElem) return true;
        const separatorElem = layerElem.nextElementSibling;

        layerElem.classList.add('fade-out');
        if (separatorElem && separatorElem.matches('.layer-separator')) {
            separatorElem.classList.add('fade-out');
        }

        setTimeout(() => {
            card.layers = card.layers.filter(layer => layer.id !== layerId);
            const cardElem = document.getElementById(cardId);
            if (!cardElem) return;
            const layersContainer = cardElem.querySelector('.layers-container');
            if (!layersContainer) return;
            renderLayers(card, layersContainer);
            if (mapInstances[card.id]) {
                setTimeout(() => mapInstances[card.id].invalidateSize(), 400);
            }
            triggerVisualisationUpdate();
        }, 300);
    }

    return true;
}

/**
 * Central click handler for card/layer management
 * Handles: add/delete cards, add/delete layers, info card toggle
 */
gridContent.addEventListener('click', function(event) {
    const target = event.target;
    if (target.classList.contains('invisible')) return;

    if (handleLayerNameMenuClick(event, target)) return;
    if (handleCoordTooltipClick(event, target)) return;
    if (handleColorSwatchClick(event, target)) return;
    if (handleAddCardClick(target)) return;
    if (handleDeleteCardClick(target)) return;
    if (handleAddLayerClick(target)) return;
    if (handleDeleteLayerClick(target)) return;

    handleHideInfoClick(target);
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

// Input helpers: draft state updates while typing.

function handleProjectTitleInput(target) {
    if (target.id !== 'dashboard-project-title') return false;
    projectTitle = target.value;
    return true;
}

function handleCoordinateDraftInput(target) {
    if (target.name !== 'latitude' && target.name !== 'longitude') return;
    const coordCardId = target.dataset.cardId;
    if (coordCardId) {
        clearCoordsInputError(coordCardId);
    }
}

function handleCardMetaInput(target, card) {
    if (target.name === 'card-title-input') {
        card.title = target.value;
        return;
    }

    if (target.name === 'nhn') {
        card.nhn = target.value ? parseFloat(target.value) : null;
        refreshLayerMetricLabels(card);
        triggerVisualisationUpdate();
    }
}

function handleLayerColorInput(target, card, cardId, layerId) {
    if (!target.classList.contains('layer-color-picker')) return false;

    const layer = card.layers.find(l => l.id === layerId);
    if (layer) {
        layer.color = target.value;
        // Update border color for instant visual feedback
        const layerElement = document.getElementById(layer.id);
        if (layerElement) {
            layerElement.style.borderLeftColor = target.value;
        }
        const colorPickerPlus = document.querySelector(`.color-picker-plus .layer-color-picker[data-card-id="${cardId}"][data-layer-id="${layerId}"]`);
        const colorPickerButton = colorPickerPlus?.closest('.color-picker-plus');
        if (colorPickerButton) {
            colorPickerButton.style.color = target.value;
            colorPickerButton.style.borderColor = target.value;
        }
    }

    return true;
}

function handleLayerDataInput(target, card, layerId) {
    const layer = card.layers.find(l => l.id === layerId);
    if (!layer) return false;

    if (target.name === 'layername') {
        layer.name = target.value;
        applyAutoColorForLayer(card.id, layer);
        showLayerNameMenuForInput(target);
    } else if (target.name === 'layerheight') {
        layer.height = target.value ? parseFloat(target.value, 10) : null;
        refreshLayerMetricLabels(card);
    }

    triggerVisualisationUpdate();
    return true;
}

gridContent.addEventListener('input', function(event) {
    const target = event.target;
    if (handleProjectTitleInput(target)) return;

    handleCoordinateDraftInput(target);

    const cardId = target.dataset.cardId;
    const card = cardsData.find(c => c.id === cardId);
    if (!card) return;

    handleCardMetaInput(target, card);

    const layerId = target.dataset.layerId;
    if (handleLayerColorInput(target, card, cardId, layerId)) return;
    handleLayerDataInput(target, card, layerId);
});

// Change helpers: commit/finalize values.

function handleFinalLayerColorChange(target) {
    if (!target.classList.contains('layer-color-picker')) return false;
    triggerVisualisationUpdate();
    return true;
}

function handleCoordinateCommitChange(target) {
    if (target.name !== 'latitude' && target.name !== 'longitude') return false;

    const cardId = target.dataset.cardId;
    if (cardId) {
        commitCoordinateInputs(cardId);
    }
    return true;
}

function handleCardEpsgChange(target) {
    if (target.name !== 'epsg') return false;

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
    return true;
}

function handleDashboardIfcEpsgChange(target) {
    if (target.id !== 'dashboard-ifc-epsg') return false;
    dashboardSelectedEPSG = target.value;
    lastSelectedEPSG = target.value;
    return true;
}

// This listener triggers the visualisation update only when the color selection is final
gridContent.addEventListener('change', function(event) {
    const target = event.target;
    if (handleFinalLayerColorChange(target)) return;
    if (handleCoordinateCommitChange(target)) return;
    if (handleCardEpsgChange(target)) return;
    handleDashboardIfcEpsgChange(target);
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
 * Centers each card's map on its own borehole marker at a fixed close-up
 * zoom level, which looks right regardless of how spread out the site is.
 * @param {object} map - Leaflet map instance
 * @param {object} card - Card data object with coords property
 */
function fitMapToBoreholes(map, card) {
    if (!card.coords) return;
    map.setView([card.coords.lat, card.coords.lng], 17);
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

    syncMapMarkers(card);

    if (card.coords) {
        syncCardMarker(card, { centerMap: false });
        updateCoordsInputs(card.id, card.coords);
    }
    fitMapToBoreholes(map, card);

    // Container may not have its final layout size yet when many maps are created
    // at once (e.g. after a JSON import) — recalc size and re-fit once it does.
    requestAnimationFrame(() => {
        map.invalidateSize();
        fitMapToBoreholes(map, card);
    });

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

function getProjectTitleValue() {
    return typeof projectTitle === 'string' ? projectTitle.trim() : '';
}

function getIfcDownloadBaseName() {
    const normalizedTitle = getProjectTitleValue().replace(/[^\w-]+/g, '_');
    return normalizedTitle || 'rummz_model';
}

function getIfcExportSnapshot() {
    const snapshotProvider = window.getRummzIfcSnapshot;
    const snapshot = typeof snapshotProvider === 'function' ? snapshotProvider() : null;
    if (!snapshot || !Array.isArray(snapshot.ifcMeshes)) return null;

    return {
        cardsData: Array.isArray(snapshot.cardsData) ? snapshot.cardsData : cardsData,
        ifcMeshes: snapshot.ifcMeshes,
        ifcOrigin: snapshot.ifcOrigin || { x: 0, y: 0, z: 0 },
        source: 'snapshot'
    };
}

function createIfcExportContext() {
    const ifcSnapshot = getIfcExportSnapshot();
    if (!ifcSnapshot) {
        throw new Error('IFC snapshot is not available. Build the visualisation first.');
    }

    const exportCardsData = Array.isArray(ifcSnapshot.cardsData) && ifcSnapshot.cardsData.length > 0 ? ifcSnapshot.cardsData : cardsData;
    const exportIfcMeshes = Array.isArray(ifcSnapshot.ifcMeshes) ? ifcSnapshot.ifcMeshes : [];

    return {
        cardsData: exportCardsData,
        ifcMeshes: exportIfcMeshes,
        ifcOrigin: ifcSnapshot.ifcOrigin || { x: 0, y: 0, z: 0 },
        boxReference: exportCardsData.length > 0 ? exportCardsData[0] : null,
        selectedEpsg: document.getElementById('dashboard-ifc-epsg')?.value || dashboardSelectedEPSG || '4326',
        fileNameBase: getIfcDownloadBaseName(),
        snapshotSource: ifcSnapshot.source || 'unknown'
    };
}

// IFC-Download (Dashboard IFC button)
async function performIfcExport() {
    const getSnapshotMeshCount = () => {
        const snapshot = getIfcExportSnapshot();
        return snapshot && Array.isArray(snapshot.ifcMeshes) ? snapshot.ifcMeshes.length : 0;
    };

    const initialSnapshot = getIfcExportSnapshot();
    console.log('performIfcExport: started', {
        ifcMeshesLength: getSnapshotMeshCount(),
        snapshotSource: initialSnapshot ? initialSnapshot.source : 'missing'
    });
    const btnEl = document.getElementById('btn-toggle-elements');
    if (btnEl) btnEl.disabled = true;
    try {
        // If IFC meshes are not yet present, trigger visualisation build and wait briefly
        if (getSnapshotMeshCount() === 0) {
            console.log('performIfcExport: no ifcMeshes found, triggering visualisation build');
            try {
                triggerVisualisationUpdate();
            } catch (e) {
                console.warn('performIfcExport: triggerVisualisationUpdate failed', e);
            }

            // Wait up to 5s for the snapshot to contain IFC meshes.
            const start = Date.now();
            const timeout = 5000;
            while (getSnapshotMeshCount() === 0 && (Date.now() - start) < timeout) {
                // yield to event loop
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r => setTimeout(r, 150));
            }
            console.log('performIfcExport: wait complete, ifcMeshesLength now', getSnapshotMeshCount());
            if (getSnapshotMeshCount() === 0) {
                alert('Keine IFC-Geometrien verfügbar. Bitte zuerst die Visualisierung laden oder warte einen Moment.');
                return;
            }
        }
        
        // proceed with IFC module import and build
        const [ifcModule, ifcBuilderModule] = await Promise.all([
            import('./ifc.js'),
            import('./ifc-export-builder.js')
        ]);
        const { generateIFCFaceSet, generateIFCBoxSet, resetIfcEntityId, getNextIfcEntityId } = ifcModule;
        const { buildIfcExport, createIfcDocumentHeader, appendIfcDocumentFooter } = ifcBuilderModule;
        console.log('performIfcExport: ifc modules imported');
        resetIfcEntityId(); // Reset IFC entity IDs
        let fullIFC = createIfcDocumentHeader();
        const exportContext = createIfcExportContext();
        // buildIfcExport may be CPU/memory heavy for large datasets; log progress
        console.log('performIfcExport: calling buildIfcExport', {
            boreholes: exportContext.cardsData.length,
            snapshotSource: exportContext.snapshotSource
        });
        fullIFC = buildIfcExport({
            fullIFC,
            exportContext,
            generateIFCFaceSet,
            generateIFCBoxSet,
            getNextIfcEntityId,
            ifcProjectedCRSDefinitions,
            resolveCoordsToEpsg,
            hexToRgb
        });
        fullIFC = appendIfcDocumentFooter(fullIFC);
        const blob = new Blob([fullIFC], { type: 'text/plain' });
        const fileName = `${exportContext.fileNameBase}.ifc`;

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
        showIfcDownloadOverlay();
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
