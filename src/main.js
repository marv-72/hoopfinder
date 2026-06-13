const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_CENTER = [16.2417, -61.5331];
const DEFAULT_ZOOM = 13;
const COURT_LIMIT = 30;

const elements = {
  courtList: document.querySelector("#court-list"),
  locateButton: document.querySelector("#locate-button"),
  refreshButton: document.querySelector("#refresh-button"),
  placeForm: document.querySelector("#place-form"),
  placeInput: document.querySelector("#place-input"),
  searchSubmit: document.querySelector(".search-submit"),
  radiusInput: document.querySelector("#radius-input"),
  radiusOutput: document.querySelector("#radius-output"),
  resultCount: document.querySelector("#result-count"),
  statusText: document.querySelector("#status-text"),
  mapLabel: document.querySelector("#map-label"),
  zoomResultsButton: document.querySelector("#zoom-results-button"),
};

const state = {
  center: DEFAULT_CENTER,
  courts: [],
  markers: L.layerGroup(),
  userMarker: null,
  lastSearchLabel: "Pointe-a-Pitre",
};

const routeChooser = createRouteChooser();
const locationPrompt = createLocationPrompt();

const map = L.map("map", {
  zoomControl: false,
  scrollWheelZoom: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);
state.markers.addTo(map);

const courtIcon = L.divIcon({
  className: "court-pin",
  html: "<span></span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const userIcon = L.divIcon({
  className: "user-pin",
  html: "<span></span>",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const sampleCourts = [
  {
    id: "sample-1",
    name: "Terrain municipal de Dugommier",
    lat: 16.2424,
    lon: -61.5349,
    surface: "beton",
    hoops: "2 paniers",
  },
  {
    id: "sample-2",
    name: "Playground de la Darse",
    lat: 16.2359,
    lon: -61.5338,
    surface: "exterieur",
    hoops: "demi-terrain",
  },
  {
    id: "sample-3",
    name: "Plateau sportif de Bergevin",
    lat: 16.2487,
    lon: -61.5265,
    surface: "asphalte",
    hoops: "2 paniers",
  },
];

function formatRadius(value) {
  return `${(Number(value) / 1000).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} km`;
}

function setBusy(isBusy) {
  elements.locateButton.disabled = isBusy;
  elements.refreshButton.disabled = isBusy;
  elements.placeInput.disabled = isBusy;
  elements.searchSubmit.disabled = isBusy;
  document.body.classList.toggle("is-loading", isBusy);
}

function setStatus(message, mapMessage = message) {
  elements.statusText.textContent = message;
  elements.mapLabel.textContent = mapMessage;
}

function distanceInMeters([latA, lonA], [latB, lonB]) {
  const earthRadius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const deltaLat = toRad(latB - latA);
  const deltaLon = toRad(lonB - lonA);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(deltaLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function courtName(tags = {}, fallback) {
  return (
    tags.name ||
    tags.operator ||
    tags["addr:street"] ||
    tags["description"] ||
    `Terrain #${fallback}`
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function wazeDirectionsUrl(court) {
  const params = new URLSearchParams({
    ll: `${court.lat},${court.lon}`,
    navigate: "yes",
    zoom: "17",
  });

  return `https://www.waze.com/ul?${params.toString()}`;
}

function googleMapsDirectionsUrl(court) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${court.lat},${court.lon}`,
    travelmode: "driving",
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function createRouteChooser() {
  const dialog = document.createElement("dialog");
  dialog.className = "route-dialog";
  dialog.innerHTML = `
    <div class="route-dialog-panel">
      <div class="route-dialog-heading">
        <div>
          <p>Choisir un itineraire</p>
          <h2 id="route-dialog-title">Terrain</h2>
          <span id="route-dialog-meta"></span>
        </div>
        <button class="route-dialog-close" type="button" aria-label="Fermer">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="route-dialog-actions">
        <a class="route-dialog-action waze-link" target="_blank" rel="noopener noreferrer">
          <i data-lucide="navigation" aria-hidden="true"></i>
          <span>
            <strong>Waze</strong>
            <small>Ouvrir l'itineraire dans Waze</small>
          </span>
        </a>
        <a class="route-dialog-action maps-link" target="_blank" rel="noopener noreferrer">
          <i data-lucide="map" aria-hidden="true"></i>
          <span>
            <strong>Google Maps</strong>
            <small>Ouvrir l'itineraire dans Maps</small>
          </span>
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const closeButton = dialog.querySelector(".route-dialog-close");
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.querySelectorAll(".route-dialog-action").forEach((link) => {
    link.addEventListener("click", () => dialog.close());
  });

  return {
    dialog,
    mapsLink: dialog.querySelector(".maps-link"),
    meta: dialog.querySelector("#route-dialog-meta"),
    title: dialog.querySelector("#route-dialog-title"),
    wazeLink: dialog.querySelector(".waze-link"),
  };
}

function openRouteChooser(court) {
  routeChooser.title.textContent = court.name;
  routeChooser.meta.textContent = `${Math.round(court.distance)} m - ${court.surface}`;
  routeChooser.wazeLink.href = wazeDirectionsUrl(court);
  routeChooser.mapsLink.href = googleMapsDirectionsUrl(court);
  routeChooser.wazeLink.setAttribute("aria-label", `Ouvrir l'itineraire Waze vers ${court.name}`);
  routeChooser.mapsLink.setAttribute("aria-label", `Ouvrir l'itineraire Google Maps vers ${court.name}`);

  if (window.lucide) {
    lucide.createIcons();
  }

  showDialog(routeChooser.dialog);
}

function createLocationPrompt() {
  const dialog = document.createElement("dialog");
  dialog.className = "route-dialog location-dialog";
  dialog.innerHTML = `
    <div class="route-dialog-panel">
      <div class="route-dialog-heading">
        <div>
          <p>Position actuelle</p>
          <h2>Trouver les terrains autour de toi</h2>
          <span>HoopFinder peut demander l'autorisation du navigateur pour utiliser ta position.</span>
        </div>
        <button class="route-dialog-close location-dismiss" type="button" aria-label="Fermer">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="location-dialog-actions">
        <button class="location-primary" type="button">
          <i data-lucide="crosshair" aria-hidden="true"></i>
          Utiliser ma position
        </button>
        <button class="location-secondary location-dismiss" type="button">Plus tard</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelectorAll(".location-dismiss").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog.querySelector(".location-primary").addEventListener("click", () => {
    dialog.close();
    locateUser();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  return { dialog };
}

function openLocationPrompt() {
  if (!navigator.geolocation || routeChooser.dialog.open) {
    return;
  }

  if (window.lucide) {
    lucide.createIcons();
  }

  showDialog(locationPrompt.dialog);
}

function showDialog(dialog) {
  if (dialog.open) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "");
}

function normalizeCourt(element, index) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const tags = element.tags || {};

  return {
    id: element.id,
    name: courtName(tags, index + 1),
    lat,
    lon,
    surface: tags.surface || tags.floor || "surface inconnue",
    hoops: tags.hoop_count ? `${tags.hoop_count} paniers` : tags.basketball || "basket",
    covered: tags.covered === "yes",
    lit: tags.lit === "yes",
    distance: distanceInMeters(state.center, [lat, lon]),
  };
}

function buildOverpassQuery([lat, lon], radius) {
  return `
    [out:json][timeout:25];
    (
      node(around:${radius},${lat},${lon})["sport"="basketball"];
      way(around:${radius},${lat},${lon})["sport"="basketball"];
      relation(around:${radius},${lat},${lon})["sport"="basketball"];
      node(around:${radius},${lat},${lon})["leisure"="pitch"]["hoops"];
      way(around:${radius},${lat},${lon})["leisure"="pitch"]["hoops"];
    );
    out center tags ${COURT_LIMIT};
  `;
}

async function fetchCourts(center = state.center) {
  const radius = elements.radiusInput.value;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: buildOverpassQuery(center, radius) }),
  });

  if (!response.ok) {
    throw new Error("Overpass n'a pas repondu correctement.");
  }

  const payload = await response.json();
  return payload.elements
    .filter((element) => element.lat || element.center)
    .map(normalizeCourt)
    .filter((court) => Number.isFinite(court.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, COURT_LIMIT);
}

async function geocodePlace(query) {
  const response = await fetch(
    `${NOMINATIM_URL}?${new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
    })}`,
    {
      headers: {
        "Accept-Language": "fr",
      },
    }
  );

  if (!response.ok) {
    throw new Error("Recherche de lieu indisponible.");
  }

  const [place] = await response.json();

  if (!place) {
    throw new Error("Aucun lieu trouve pour cette recherche.");
  }

  return {
    center: [Number(place.lat), Number(place.lon)],
    label: place.display_name.split(",").slice(0, 2).join(","),
  };
}

function renderCourts(courts) {
  state.markers.clearLayers();
  elements.courtList.innerHTML = "";
  elements.resultCount.textContent = courts.length;

  courts.forEach((court, index) => {
    const safeName = escapeHtml(court.name);
    const safeSurface = escapeHtml(court.surface);
    const safeMeta = escapeHtml(court.lit ? "eclaire" : court.hoops);
    const marker = L.marker([court.lat, court.lon], { icon: courtIcon })
      .bindPopup(`<strong>${safeName}</strong><br>${Math.round(court.distance)} m`);
    marker.addTo(state.markers);

    const item = document.createElement("li");
    item.className = "court-item";
    item.innerHTML = `
      <div class="court-card">
      <button class="court-focus" type="button" aria-label="Choisir un itineraire vers ${safeName}">
        <span class="rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="court-copy">
          <strong>${safeName}</strong>
          <span>${Math.round(court.distance)} m - ${safeSurface}</span>
        </span>
        <span class="court-meta">${safeMeta}</span>
        <span class="court-route-hint">
          <i data-lucide="route" aria-hidden="true"></i>
          <span>Itineraire</span>
        </span>
      </button>
      </div>
    `;
    item.querySelector(".court-focus").addEventListener("click", () => {
      map.flyTo([court.lat, court.lon], 17, { duration: 0.8 });
      marker.openPopup();
      openRouteChooser(court);
    });
    elements.courtList.appendChild(item);
  });

  if (courts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Aucun terrain trouve dans ce rayon. Essaie un rayon plus large.";
    elements.courtList.appendChild(empty);
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}

function fitCourtBounds() {
  const points = state.courts.map((court) => [court.lat, court.lon]);

  if (state.userMarker) {
    points.push(state.center);
  }

  if (points.length === 0) {
    map.setView(state.center, DEFAULT_ZOOM);
    return;
  }

  map.fitBounds(L.latLngBounds(points), {
    padding: [70, 70],
    maxZoom: 16,
  });
}

async function runSearch(center = state.center, label = state.lastSearchLabel) {
  setBusy(true);
  state.center = center;
  state.lastSearchLabel = label;
  setStatus(`Recherche autour de ${label}...`, "Recherche en cours");

  try {
    const courts = await fetchCourts(center);
    state.courts = courts.length ? courts : sampleCourts.map((court) => ({
      ...court,
      distance: distanceInMeters(center, [court.lat, court.lon]),
    }));

    renderCourts(state.courts);
    fitCourtBounds();

    const sourceLabel = courts.length ? "terrains trouves" : "exemples affiches";
    setStatus(`${state.courts.length} ${sourceLabel} autour de ${label}.`, `${state.courts.length} spots`);
  } catch (error) {
    state.courts = sampleCourts.map((court) => ({
      ...court,
      distance: distanceInMeters(center, [court.lat, court.lon]),
    }));
    renderCourts(state.courts);
    fitCourtBounds();
    setStatus(`${error.message} Exemples affiches en attendant.`, "Mode exemple");
  } finally {
    setBusy(false);
  }
}

function updateUserPosition(center) {
  if (state.userMarker) {
    state.userMarker.setLatLng(center);
  } else {
    state.userMarker = L.marker(center, { icon: userIcon }).addTo(map).bindPopup("Ta position");
  }
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus("La geolocalisation n'est pas disponible dans ce navigateur.");
    return;
  }

  setBusy(true);
  setStatus("Recherche de ta position...", "Geolocalisation");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const center = [position.coords.latitude, position.coords.longitude];
      updateUserPosition(center);
      runSearch(center, "ta position");
    },
    () => {
      setBusy(false);
      setStatus("Impossible d'obtenir ta position. Cherche une ville a la place.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}

elements.locateButton.addEventListener("click", locateUser);
elements.refreshButton.addEventListener("click", () => runSearch());
elements.zoomResultsButton.addEventListener("click", fitCourtBounds);
elements.radiusInput.addEventListener("input", () => {
  elements.radiusOutput.textContent = formatRadius(elements.radiusInput.value);
});
elements.radiusInput.addEventListener("change", () => runSearch());

elements.placeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.placeInput.value.trim();

  if (!query) {
    elements.placeInput.focus();
    return;
  }

  setBusy(true);
  setStatus(`Recherche de ${query}...`, "Recherche de lieu");

  try {
    const place = await geocodePlace(query);
    updateUserPosition(place.center);
    await runSearch(place.center, place.label);
  } catch (error) {
    setStatus(error.message, "Lieu introuvable");
    setBusy(false);
  }
});

elements.radiusOutput.textContent = formatRadius(elements.radiusInput.value);
renderCourts([]);

window.addEventListener("load", () => {
  lucide.createIcons();
  runSearch(DEFAULT_CENTER, state.lastSearchLabel);
  window.setTimeout(openLocationPrompt, 500);
});
