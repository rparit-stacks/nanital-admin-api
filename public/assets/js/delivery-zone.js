/* global google, L, panel, handleDelete */

let map;
let marker;
let infoWindow;
let polygon = null;
let originalPolygon = null;
let drawingManager;
let center = { lat: 40.749933, lng: -73.98633 };
let otherZonePolygons = [];

/** OpenStreetMap / Leaflet (no Google API key) */
let osmMap;
let osmDrawnItems;
let osmPolygon = null;
let osmOriginalPath = null;
let osmOtherLayers = [];

function getMapProvider() {
    const cfg = document.getElementById("delivery-zone-config");
    return cfg?.getAttribute("data-provider") || "google";
}

function waitForGoogleMaps(callback) {
    if (window.google?.maps?.importLibrary) {
        callback();
        return;
    }
    const start = Date.now();
    const id = setInterval(() => {
        if (window.google?.maps?.importLibrary) {
            clearInterval(id);
            callback();
        } else if (Date.now() - start > 60000) {
            clearInterval(id);
            console.error("Google Maps failed to load");
        }
    }, 100);
}

async function initGoogleMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    const { DrawingManager } = await google.maps.importLibrary("drawing");
    await google.maps.importLibrary("places");

    const centerLatInput = document.getElementById("center-latitude");
    const centerLngInput = document.getElementById("center-longitude");
    if (centerLatInput.value && centerLngInput.value) {
        center = {
            lat: parseFloat(centerLatInput.value),
            lng: parseFloat(centerLngInput.value),
        };
    }
    map = new Map(document.getElementById("map"), {
        center,
        zoom: 13,
        mapId: "4504f8b37365c3d0",
        mapTypeControl: false,
    });

    const placeAutocomplete = new google.maps.places.PlaceAutocompleteElement();
    placeAutocomplete.id = "place-autocomplete-input";
    placeAutocomplete.locationBias = center;
    const card = document.getElementById("place-autocomplete-card");
    card.appendChild(placeAutocomplete);
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(card);

    marker = new AdvancedMarkerElement({ map });
    infoWindow = new google.maps.InfoWindow({});

    placeAutocomplete.addEventListener("gmp-select", async ({ placePrediction }) => {
        const place = placePrediction.toPlace();
        await place.fetchFields({
            fields: ["displayName", "formattedAddress", "location"],
        });
        if (place.viewport) {
            map.fitBounds(place.viewport);
        } else {
            map.setCenter(place.location);
            map.setZoom(17);
        }
        const content = `<div id="infowindow-content">
            <span id="place-displayname" class="title">${place.displayName}</span><br />
            <span id="place-address">${place.formattedAddress}</span>
        </div>`;
        updateInfoWindow(content, place.location);
        marker.position = place.location;
    });

    drawingManager = new DrawingManager({
        drawingMode: google.maps.drawing.OverlayType.POLYGON,
        drawingControl: true,
        drawingControlOptions: {
            position: google.maps.ControlPosition.TOP_CENTER,
            drawingModes: ["polygon"],
        },
        polygonOptions: {
            fillColor: "#FF0000",
            fillOpacity: 0.2,
            strokeWeight: 2,
            clickable: true,
            editable: true,
            zIndex: 1,
        },
    });
    drawingManager.setMap(map);

    google.maps.event.addListener(drawingManager, "polygoncomplete", function (newPolygon) {
        if (polygon) {
            polygon.setMap(null);
        }
        polygon = newPolygon;
        updateBoundaryInput(polygon);
        setPolygonListeners(polygon);
        drawingManager.setDrawingMode(null);
    });

    const boundaryJsonInput = document.getElementById("boundary-json");
    if (boundaryJsonInput.value) {
        try {
            const pathArr = JSON.parse(boundaryJsonInput.value);
            if (Array.isArray(pathArr) && pathArr.length > 0) {
                const path = pathArr.map((coord) => new google.maps.LatLng(coord.lat, coord.lng));
                originalPolygon = new google.maps.Polygon({
                    paths: path,
                    fillColor: "#FF0000",
                    fillOpacity: 0.2,
                    strokeWeight: 2,
                    editable: true,
                    map: map,
                });
                map.fitBounds(getBoundsForPath(path));
                polygon = originalPolygon;
                updateBoundaryInput(polygon);
                setPolygonListeners(polygon);
            }
        } catch (e) {
            // ignore
        }
    }

    try {
        await renderOtherDeliveryZonesGoogle();
    } catch (e) {
        console.warn("Unable to render other delivery zones on form:", e);
    }

    document.getElementById("clear-last")?.addEventListener("click", function () {
        if (polygon) {
            polygon.setMap(null);
            polygon = null;
            document.getElementById("boundary-json").value = "";
        }
    });

    document.getElementById("reset-zone")?.addEventListener("click", function () {
        if (originalPolygon) {
            if (polygon) polygon.setMap(null);
            const origPath = originalPolygon.getPath().getArray().map((latlng) => ({
                lat: latlng.lat(),
                lng: latlng.lng(),
            }));
            polygon = new google.maps.Polygon({
                paths: origPath,
                fillColor: "#FF0000",
                fillOpacity: 0.2,
                strokeWeight: 2,
                editable: true,
                map: map,
            });
            map.fitBounds(
                getBoundsForPath(origPath.map((coord) => new google.maps.LatLng(coord.lat, coord.lng))),
            );
            updateBoundaryInput(polygon);
            setPolygonListeners(polygon);
        }
    });
}

function initOsmMap() {
    if (typeof L === "undefined") {
        console.error("Leaflet is not loaded");
        return;
    }

    const centerLatInput = document.getElementById("center-latitude");
    const centerLngInput = document.getElementById("center-longitude");
    let lat = 40.749933;
    let lng = -73.98633;
    if (centerLatInput.value && centerLngInput.value) {
        lat = parseFloat(centerLatInput.value);
        lng = parseFloat(centerLngInput.value);
    }

    const mapEl = document.getElementById("map");
    mapEl.innerHTML = "";
    osmMap = L.map(mapEl).setView([lat, lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(osmMap);

    osmDrawnItems = new L.FeatureGroup();
    osmMap.addLayer(osmDrawnItems);

    const drawControl = new L.Control.Draw({
        edit: {
            featureGroup: osmDrawnItems,
        },
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: false,
                shapeOptions: {
                    color: "#ff0000",
                    fillOpacity: 0.2,
                    weight: 2,
                },
            },
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false,
        },
    });
    osmMap.addControl(drawControl);

    osmMap.on(L.Draw.Event.CREATED, function (e) {
        if (osmPolygon) {
            osmDrawnItems.removeLayer(osmPolygon);
        }
        osmPolygon = e.layer;
        osmDrawnItems.addLayer(osmPolygon);
        updateBoundaryInputLeaflet(osmPolygon);
    });

    osmMap.on(L.Draw.Event.EDITED, function (e) {
        e.layers.eachLayer(function (layer) {
            if (layer === osmPolygon) {
                updateBoundaryInputLeaflet(layer);
            }
        });
    });

    osmMap.on(L.Draw.Event.DELETED, function () {
        osmPolygon = null;
        document.getElementById("boundary-json").value = "";
    });

    const boundaryJsonInput = document.getElementById("boundary-json");
    if (boundaryJsonInput.value) {
        try {
            const pathArr = JSON.parse(boundaryJsonInput.value);
            if (Array.isArray(pathArr) && pathArr.length > 0) {
                osmOriginalPath = JSON.parse(JSON.stringify(pathArr));
                const latlngs = pathArr.map((c) => [c.lat, c.lng]);
                osmPolygon = L.polygon(latlngs, {
                    color: "#ff0000",
                    fillOpacity: 0.2,
                    weight: 2,
                });
                osmDrawnItems.addLayer(osmPolygon);
                osmMap.fitBounds(osmPolygon.getBounds().pad(0.1));
                updateBoundaryInputLeaflet(osmPolygon);
            }
        } catch (e) {
            // ignore
        }
    }

    setupOsmSearchUi();

    renderOtherDeliveryZonesOsm().catch((e) =>
        console.warn("Unable to render other delivery zones on form:", e),
    );

    document.getElementById("clear-last")?.addEventListener("click", function () {
        if (osmPolygon) {
            osmDrawnItems.removeLayer(osmPolygon);
            osmPolygon = null;
            document.getElementById("boundary-json").value = "";
        }
    });

    document.getElementById("reset-zone")?.addEventListener("click", function () {
        if (osmOriginalPath && osmOriginalPath.length > 0) {
            if (osmPolygon) {
                osmDrawnItems.removeLayer(osmPolygon);
            }
            const latlngs = osmOriginalPath.map((c) => [c.lat, c.lng]);
            osmPolygon = L.polygon(latlngs, {
                color: "#ff0000",
                fillOpacity: 0.2,
                weight: 2,
            });
            osmDrawnItems.addLayer(osmPolygon);
            osmMap.fitBounds(osmPolygon.getBounds().pad(0.1));
            updateBoundaryInputLeaflet(osmPolygon);
        }
    });

    setTimeout(() => osmMap.invalidateSize(), 200);
}

function setupOsmSearchUi() {
    const card = document.getElementById("place-autocomplete-card");
    if (!card) return;
    card.innerHTML =
        "<p class=\"mb-1\">Search place (Photon / OpenStreetMap):</p>" +
        "<div class=\"input-group input-group-sm\">" +
        "<input type=\"text\" class=\"form-control\" id=\"osm-search-q\" placeholder=\"City, address...\" />" +
        "<button class=\"btn btn-outline-secondary\" type=\"button\" id=\"osm-search-btn\">Search</button>" +
        "</div>" +
        "<div id=\"osm-search-results\" class=\"list-group list-group-flush mt-2\" style=\"max-height:200px;overflow:auto;\"></div>";

    const runSearch = async () => {
        const q = document.getElementById("osm-search-q")?.value?.trim();
        const resultsEl = document.getElementById("osm-search-results");
        if (!q || !resultsEl) return;
        resultsEl.innerHTML = "<span class=\"text-muted small\">Searching…</span>";
        try {
            const url =
                "https://photon.komoot.io/api/?q=" +
                encodeURIComponent(q) +
                "&limit=8&lang=en";
            const res = await fetch(url);
            const data = await res.json();
            const features = data.features || [];
            resultsEl.innerHTML = "";
            if (!features.length) {
                resultsEl.innerHTML = "<span class=\"text-muted small\">No results</span>";
                return;
            }
            features.forEach((f) => {
                const coords = f.geometry?.coordinates;
                const p = f.properties || {};
                if (!coords) return;
                const [flng, flat] = coords;
                const label = p.name || p.street || q;
                const sub = [p.city || p.town, p.country].filter(Boolean).join(", ");
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "list-group-item list-group-item-action py-1 px-2 text-start small";
                btn.textContent = sub ? `${label} — ${sub}` : label;
                btn.addEventListener("click", () => {
                    osmMap.setView([flat, flng], 15);
                    resultsEl.innerHTML = "";
                });
                resultsEl.appendChild(btn);
            });
        } catch (e) {
            resultsEl.innerHTML = "<span class=\"text-danger small\">Search failed</span>";
        }
    };

    document.getElementById("osm-search-btn")?.addEventListener("click", runSearch);
    document.getElementById("osm-search-q")?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            runSearch();
        }
    });
}

function updateBoundaryInputLeaflet(layer) {
    const rings = layer.getLatLngs();
    const ring = Array.isArray(rings[0]) ? rings[0] : rings;
    const path = ring.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
    document.getElementById("boundary-json").value = JSON.stringify(path);

    const c = getPolygonCentroid(path);
    if (c) {
        document.getElementById("center-latitude").value = c.lat;
        document.getElementById("center-longitude").value = c.lng;
    }
    const radiusKm = getMaxRadiusKm(c, path);
    document.getElementById("radius-km").value = radiusKm.toFixed(3);
}

async function renderOtherDeliveryZonesGoogle() {
    if (otherZonePolygons.length) {
        otherZonePolygons.forEach((p) => p.setMap(null));
        otherZonePolygons = [];
    }

    const currentZoneIdEl = document.getElementById("current-zone-id");
    const currentZoneId = currentZoneIdEl ? parseInt(currentZoneIdEl.value, 10) : null;

    const response = await fetch("/api/delivery-zone?per_page=500", {
        headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const json = await response.json();
    const items =
        json && json.data && Array.isArray(json.data.data)
            ? json.data.data
            : Array.isArray(json.data)
              ? json.data
              : [];
    if (!items.length) return;

    items.forEach((zone) => {
        if (currentZoneId && zone.id === currentZoneId) return;
        if (!zone.boundary_json || !Array.isArray(zone.boundary_json) || zone.boundary_json.length < 3)
            return;
        const path = zone.boundary_json
            .map((pt) => ({ lat: parseFloat(pt.lat), lng: parseFloat(pt.lng) }))
            .filter((p) => !Number.isNaN(p.lat) && !Number.isNaN(p.lng));
        if (path.length < 3) return;

        const overlay = new google.maps.Polygon({
            paths: path,
            strokeColor: "#0066ff",
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: "#1a73e8",
            fillOpacity: 0.08,
            clickable: false,
            zIndex: 0,
            map: map,
        });
        otherZonePolygons.push(overlay);
    });
}

async function renderOtherDeliveryZonesOsm() {
    if (!osmMap) return;
    osmOtherLayers.forEach((l) => osmMap.removeLayer(l));
    osmOtherLayers = [];

    const currentZoneIdEl = document.getElementById("current-zone-id");
    const currentZoneId = currentZoneIdEl ? parseInt(currentZoneIdEl.value, 10) : null;

    const response = await fetch("/api/delivery-zone?per_page=500", {
        headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const json = await response.json();
    const items =
        json && json.data && Array.isArray(json.data.data)
            ? json.data.data
            : Array.isArray(json.data)
              ? json.data
              : [];
    if (!items.length) return;

    items.forEach((zone) => {
        if (currentZoneId && zone.id === currentZoneId) return;
        if (!zone.boundary_json || !Array.isArray(zone.boundary_json) || zone.boundary_json.length < 3)
            return;
        const latlngs = zone.boundary_json
            .map((pt) => [parseFloat(pt.lat), parseFloat(pt.lng)])
            .filter((p) => !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
        if (latlngs.length < 3) return;

        const poly = L.polygon(latlngs, {
            color: "#0066ff",
            weight: 2,
            opacity: 0.8,
            fillColor: "#1a73e8",
            fillOpacity: 0.08,
            interactive: false,
        });
        poly.addTo(osmMap);
        osmOtherLayers.push(poly);
    });
}

function updateBoundaryInput(poly) {
    const path = poly.getPath().getArray().map((latlng) => ({
        lat: latlng.lat(),
        lng: latlng.lng(),
    }));
    document.getElementById("boundary-json").value = JSON.stringify(path);

    const c = getPolygonCentroid(path);
    if (c) {
        document.getElementById("center-latitude").value = c.lat;
        document.getElementById("center-longitude").value = c.lng;
    }
    const radiusKm = getMaxRadiusKm(c, path);
    document.getElementById("radius-km").value = radiusKm.toFixed(3);
}

function getPolygonCentroid(path) {
    if (!path.length) return null;
    let la = 0;
    let ln = 0;
    path.forEach((point) => {
        la += point.lat;
        ln += point.lng;
    });
    return { lat: la / path.length, lng: ln / path.length };
}

function getMaxRadiusKm(c, path) {
    if (!c || !path?.length) return 0;
    let maxDist = 0;
    path.forEach((point) => {
        const dist = haversineDistance(c, point);
        if (dist > maxDist) maxDist = dist;
    });
    return maxDist;
}

function haversineDistance(coord1, coord2) {
    const R = 6371;
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLng = toRad(coord2.lng - coord1.lng);
    const lat1 = toRad(coord1.lat);
    const lat2 = toRad(coord2.lat);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

function setPolygonListeners(poly) {
    google.maps.event.clearListeners(poly.getPath(), "set_at");
    google.maps.event.clearListeners(poly.getPath(), "insert_at");
    google.maps.event.clearListeners(poly.getPath(), "remove_at");
    poly.getPath().addListener("set_at", () => updateBoundaryInput(poly));
    poly.getPath().addListener("insert_at", () => updateBoundaryInput(poly));
    poly.getPath().addListener("remove_at", () => updateBoundaryInput(poly));
}

function getBoundsForPath(path) {
    const bounds = new google.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    return bounds;
}

function updateInfoWindow(content, position) {
    infoWindow.setContent(content);
    infoWindow.setPosition(position);
    infoWindow.open({ map, anchor: marker, shouldFocus: false });
}

function bootstrapDeliveryZoneMap() {
    const provider = getMapProvider();
    if (provider === "osm") {
        initOsmMap();
        return;
    }
    waitForGoogleMaps(() => {
        initGoogleMap().catch((e) => console.error("Error initializing Google map:", e));
    });
}

document.addEventListener("DOMContentLoaded", function () {
    bootstrapDeliveryZoneMap();
    document.addEventListener("click", function (event) {
        handleDelete(event, ".delete-delivery-zone", `/${panel}/delivery-zones/`, "You are about to delete this Zone.");
    });
});
