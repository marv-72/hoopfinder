const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const DEFAULT_CENTER = [16.2417, -61.5331];
const DEFAULT_ZOOM = 13;
const COURT_LIMIT = 30;
const NAME_ENRICH_LIMIT = COURT_LIMIT;
const NAME_ENRICH_DELAY_MS = 1100;
const VIP_REGION_RADIUS = 18000;
const VIP_TERRITORY_RADIUS = 90000;
const VIP_COURT_LIMIT = 140;
const VIP_PASS_STORAGE_KEY = "hoopfinder-vip-pass";
const reverseNameCache = new Map();

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
  vipCard: document.querySelector("#vip-card"),
  vipContent: document.querySelector("#vip-content"),
  vipList: document.querySelector("#vip-list"),
  vipLocked: document.querySelector("#vip-locked"),
  vipScopeButtons: document.querySelectorAll("[data-vip-scope]"),
  vipUnlockButton: document.querySelector("#vip-unlock-button"),
};

const state = {
  center: DEFAULT_CENTER,
  courts: [],
  markers: L.layerGroup(),
  userMarker: null,
  lastSearchLabel: "Pointe-a-Pitre",
  vipCourts: {
    region: [],
    territoire: [],
  },
  vipCenterKeys: {
    region: "",
    territoire: "",
  },
  vipLoading: false,
  vipScope: "region",
  vipUnlocked: localStorage.getItem(VIP_PASS_STORAGE_KEY) === "active",
  searchRunId: 0,
};

const routeChooser = createRouteChooser();
const courtDetails = createCourtDetails();
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

function cleanNameCandidate(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstCleanValue(...values) {
  return values.map(cleanNameCandidate).find(Boolean) || "";
}

function streetAddress(tags = {}) {
  return [
    tags["addr:housenumber"],
    tags["addr:street"],
  ].map(cleanNameCandidate).filter(Boolean).join(" ");
}

function courtNameInfo(tags = {}) {
  const realName = firstCleanValue(
    tags.name,
    tags["name:fr"],
    tags.official_name,
    tags.alt_name,
    tags.short_name
  );

  if (realName) {
    return {
      hasRealName: true,
      name: realName,
      source: "nom OpenStreetMap",
    };
  }

  const operator = firstCleanValue(tags.operator, tags.owner, tags.brand);

  if (operator) {
    return {
      hasRealName: false,
      name: `Terrain de basket - ${operator}`,
      source: "operateur OpenStreetMap",
    };
  }

  const address = firstCleanValue(streetAddress(tags), tags["addr:place"]);

  if (address) {
    return {
      hasRealName: false,
      name: `Terrain de basket - ${address}`,
      source: "adresse OpenStreetMap",
    };
  }

  const description = firstCleanValue(tags.description);

  if (description) {
    return {
      hasRealName: false,
      name: description,
      source: "description OpenStreetMap",
    };
  }

  return {
    hasRealName: false,
    name: "Terrain de basket sans nom",
    source: "nom a enrichir",
  };
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

function readableValue(value, fallback = "non renseigne") {
  if (value === true || value === "yes") {
    return "oui";
  }

  if (value === false || value === "no") {
    return "non";
  }

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function wikimediaFileName(value) {
  const name = String(value || "").trim();

  if (!name || /^category:/i.test(name)) {
    return "";
  }

  return name.replace(/^file:/i, "File:");
}

function wikimediaUrl(value) {
  const fileName = wikimediaFileName(value);

  if (!fileName) {
    return "";
  }

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
}

function osmElementUrl(court) {
  if (!court.osmType || !court.id) {
    return "";
  }

  return `https://www.openstreetmap.org/${court.osmType}/${court.id}`;
}

function courtPhoto(court) {
  const tags = court.rawTags || {};
  const imageUrl = safeExternalUrl((tags.image || tags["image:0"] || "").split(";")[0]);

  if (imageUrl) {
    return {
      caption: "Photo renseignee dans OpenStreetMap",
      url: imageUrl,
    };
  }

  const wikimediaImage = wikimediaUrl(tags.wikimedia_commons);

  if (wikimediaImage) {
    return {
      caption: "Photo Wikimedia Commons liee a OpenStreetMap",
      url: wikimediaImage,
    };
  }

  return null;
}

function courtHoopsInfo(court) {
  const basketball = normalizedText(court.basketball);

  if (court.hoopCount > 1) {
    return `${court.hoopCount} paniers`;
  }

  if (court.hoopCount === 1) {
    return "1 panier - moins equipe";
  }

  if (/half|demi|half_court/.test(basketball)) {
    return "demi-terrain - moins de paniers";
  }

  if (court.hoops && court.hoops !== "basket") {
    return court.hoops;
  }

  return "paniers non renseignes";
}

function courtDetailRows(court) {
  const tags = court.rawTags || {};
  const osmUrl = osmElementUrl(court);

  return [
    ["Nom affiche", court.name],
    ["Source du nom", court.nameSource],
    ["Distance", `${Math.round(court.distance)} m`],
    ["Paniers", courtHoopsInfo(court)],
    ["Surface", court.surface],
    ["Eclairage", court.lit ? "oui" : readableValue(tags.lit)],
    ["Couvert", court.covered ? "oui" : readableValue(tags.covered)],
    ["Indoor", court.indoor ? "oui" : readableValue(tags.indoor)],
    ["Acces", court.access],
    ["Payant", readableValue(court.fee)],
    ["Operateur", court.operator],
    ["Horaires", tags.opening_hours],
    ["Adresse", tags["addr:full"] || tags["addr:street"]],
    ["Description", tags.description],
    ["Site web", safeExternalUrl(tags.website || tags["contact:website"])],
    ["Mapillary", tags.mapillary ? "photo de rue referencee" : ""],
    ["Type", court.leisure || court.sport || court.basketball],
    ["Source OSM", osmUrl],
    ["Coordonnees", `${court.lat.toFixed(5)}, ${court.lon.toFixed(5)}`],
  ];
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
  routeChooser.meta.textContent = `${Math.round(court.distance)} m - ${courtHoopsInfo(court)}`;
  routeChooser.wazeLink.href = wazeDirectionsUrl(court);
  routeChooser.mapsLink.href = googleMapsDirectionsUrl(court);
  routeChooser.wazeLink.setAttribute("aria-label", `Ouvrir l'itineraire Waze vers ${court.name}`);
  routeChooser.mapsLink.setAttribute("aria-label", `Ouvrir l'itineraire Google Maps vers ${court.name}`);

  if (window.lucide) {
    lucide.createIcons();
  }

  showDialog(routeChooser.dialog);
}

function createCourtDetails() {
  const dialog = document.createElement("dialog");
  dialog.className = "route-dialog court-detail-dialog";
  dialog.innerHTML = `
    <div class="route-dialog-panel">
      <div class="route-dialog-heading">
        <div>
          <p>Fiche terrain</p>
          <h2 id="court-detail-title">Terrain</h2>
          <span id="court-detail-meta"></span>
        </div>
        <button class="route-dialog-close court-detail-close" type="button" aria-label="Fermer">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <figure class="court-detail-photo" id="court-detail-photo" hidden>
        <img alt="" loading="lazy" />
        <figcaption></figcaption>
      </figure>
      <p class="court-detail-photo-empty" id="court-detail-photo-empty" hidden>
        Aucune photo reelle n'est renseignee pour ce terrain dans OpenStreetMap.
      </p>
      <dl class="court-detail-list" id="court-detail-list"></dl>
      <div class="court-detail-actions">
        <button class="court-detail-route" type="button">
          <i data-lucide="route" aria-hidden="true"></i>
          Itineraire
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const closeButton = dialog.querySelector(".court-detail-close");
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  return {
    dialog,
    list: dialog.querySelector("#court-detail-list"),
    meta: dialog.querySelector("#court-detail-meta"),
    photo: dialog.querySelector("#court-detail-photo"),
    photoCaption: dialog.querySelector("#court-detail-photo figcaption"),
    photoEmpty: dialog.querySelector("#court-detail-photo-empty"),
    photoImage: dialog.querySelector("#court-detail-photo img"),
    routeButton: dialog.querySelector(".court-detail-route"),
    title: dialog.querySelector("#court-detail-title"),
  };
}

function openCourtDetails(court) {
  const photo = courtPhoto(court);

  courtDetails.title.textContent = court.name;
  courtDetails.meta.textContent = `${Math.round(court.distance)} m - ${court.surface}`;
  courtDetails.photo.hidden = !photo;
  courtDetails.photoEmpty.hidden = Boolean(photo);

  if (photo) {
    courtDetails.photoImage.src = photo.url;
    courtDetails.photoImage.alt = `Photo reelle du terrain ${court.name}`;
    courtDetails.photoCaption.textContent = photo.caption;
  } else {
    courtDetails.photoImage.removeAttribute("src");
    courtDetails.photoImage.alt = "";
    courtDetails.photoCaption.textContent = "";
  }

  courtDetails.list.innerHTML = courtDetailRows(court)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => {
      const displayValue = readableValue(value);
      const safeUrl = safeExternalUrl(displayValue);

      return `
      <div class="court-detail-row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${
          safeUrl
            ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`
            : escapeHtml(displayValue)
        }</dd>
      </div>
    `;
    })
    .join("");

  courtDetails.routeButton.onclick = () => {
    courtDetails.dialog.close();
    map.flyTo([court.lat, court.lon], 17, { duration: 0.8 });
    openRouteChooser(court);
  };

  if (window.lucide) {
    lucide.createIcons();
  }

  showDialog(courtDetails.dialog);
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
  const nameInfo = courtNameInfo(tags, index + 1);

  return {
    access: tags.access || "public",
    basketball: tags.basketball || "",
    fee: tags.fee || "no",
    hasRealName: nameInfo.hasRealName,
    id: element.id,
    name: nameInfo.name,
    nameSource: nameInfo.source,
    lat,
    leisure: tags.leisure || "",
    lon,
    osmType: element.type,
    operator: tags.operator || "",
    sport: tags.sport || "",
    surface: tags.surface || tags.floor || "surface inconnue",
    hoops: tags.hoop_count ? `${tags.hoop_count} paniers` : tags.basketball || "basket",
    hoopCount: Number(tags.hoop_count || 0),
    covered: tags.covered === "yes",
    indoor: tags.indoor === "yes",
    lit: tags.lit === "yes",
    rawTags: tags,
    distance: distanceInMeters(state.center, [lat, lon]),
  };
}

function reverseNameCacheKey(court) {
  return `${court.lat.toFixed(5)},${court.lon.toFixed(5)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function placeNameFromAddress(address = {}) {
  const venue = firstCleanValue(
    address.sports_centre,
    address.recreation_ground,
    address.pitch,
    address.playground,
    address.park,
    address.school,
    address.university
  );

  if (venue) {
    return `Terrain de basket - ${venue}`;
  }

  const street = firstCleanValue(address.road, address.pedestrian, address.footway, address.cycleway);
  const district = firstCleanValue(
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.hamlet,
    address.village,
    address.town,
    address.city,
    address.municipality
  );

  if (street && district) {
    return `Terrain de basket - ${street}, ${district}`;
  }

  if (street) {
    return `Terrain de basket - ${street}`;
  }

  if (district) {
    return `Terrain de basket - ${district}`;
  }

  return "";
}

function courtNameFromReverse(place) {
  const address = place.address || {};
  const namedetails = place.namedetails || {};
  const placeName = firstCleanValue(
    namedetails["name:fr"],
    namedetails.name,
    place.name
  );

  if (placeName && !/^(basketball|basket|pitch|terrain)$/i.test(placeName)) {
    return {
      name: placeName,
      source: "nom proche Nominatim",
    };
  }

  const addressName = placeNameFromAddress(address);

  if (addressName) {
    return {
      name: addressName,
      source: "adresse Nominatim",
    };
  }

  return null;
}

async function reverseLookupCourtName(court) {
  const key = reverseNameCacheKey(court);

  if (reverseNameCache.has(key)) {
    return reverseNameCache.get(key);
  }

  const response = await fetch(`${NOMINATIM_REVERSE_URL}?${new URLSearchParams({
    lat: String(court.lat),
    lon: String(court.lon),
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    zoom: "18",
  })}`, {
    headers: {
      "Accept-Language": "fr",
    },
  });

  if (!response.ok) {
    throw new Error("Nom du terrain indisponible.");
  }

  const place = await response.json();
  const nameInfo = courtNameFromReverse(place);
  reverseNameCache.set(key, nameInfo);
  return nameInfo;
}

function applyEnrichedCourtName(court, nameInfo) {
  if (!nameInfo || court.hasRealName) {
    return false;
  }

  court.name = nameInfo.name;
  court.nameSource = nameInfo.source;
  court.nameEnriched = true;
  return true;
}

async function enrichCourtNames(searchRunId, label) {
  const targets = state.courts
    .filter((court) => !court.hasRealName && !court.nameEnriched)
    .slice(0, NAME_ENRICH_LIMIT);

  if (targets.length === 0) {
    return;
  }

  let updatedCount = 0;
  setStatus(`Recherche des vrais noms autour de ${label}...`, "Noms des terrains");

  for (const [index, court] of targets.entries()) {
    if (state.searchRunId !== searchRunId) {
      return;
    }

    if (index > 0) {
      await delay(NAME_ENRICH_DELAY_MS);
    }

    try {
      const nameInfo = await reverseLookupCourtName(court);

      if (applyEnrichedCourtName(court, nameInfo)) {
        updatedCount += 1;
        renderCourts(state.courts);
      }
    } catch {
      reverseNameCache.set(reverseNameCacheKey(court), null);
    }
  }

  if (state.searchRunId === searchRunId) {
    const nameStatus = updatedCount > 0 ? "Noms ameliores." : "Certains terrains restent sans nom officiel.";
    setStatus(`${state.courts.length} terrains trouves autour de ${label}. ${nameStatus}`, `${state.courts.length} spots`);
  }
}

function buildOverpassQuery([lat, lon], radius, limit = COURT_LIMIT) {
  return `
    [out:json][timeout:25];
    (
      node(around:${radius},${lat},${lon})["sport"="basketball"];
      way(around:${radius},${lat},${lon})["sport"="basketball"];
      relation(around:${radius},${lat},${lon})["sport"="basketball"];
      node(around:${radius},${lat},${lon})["leisure"="pitch"]["hoops"];
      way(around:${radius},${lat},${lon})["leisure"="pitch"]["hoops"];
    );
    out center tags ${limit};
  `;
}

async function fetchCourts(center = state.center, radius = elements.radiusInput.value, limit = COURT_LIMIT) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: buildOverpassQuery(center, radius, limit) }),
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
    .slice(0, limit);
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
        <button class="court-info-button" type="button" aria-label="Voir plus d'informations sur ${safeName}">
          <i data-lucide="plus" aria-hidden="true"></i>
          Plus d'infos
        </button>
      </div>
    `;
    item.querySelector(".court-focus").addEventListener("click", () => {
      map.flyTo([court.lat, court.lon], 17, { duration: 0.8 });
      marker.openPopup();
      openRouteChooser(court);
    });
    item.querySelector(".court-info-button").addEventListener("click", () => {
      map.flyTo([court.lat, court.lon], 17, { duration: 0.8 });
      marker.openPopup();
      openCourtDetails(court);
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

function centerCourtAndOpenRoute(court) {
  map.flyTo([court.lat, court.lon], 17, { duration: 0.8 });
  openRouteChooser(court);
}

function vipDisplayName(court, index) {
  return court.hasRealName ? court.name : `Spot VIP #${index + 1}`;
}

function vipCenterKey(scope) {
  return `${scope}:${state.center[0].toFixed(3)},${state.center[1].toFixed(3)}`;
}

function courtIdentity(court) {
  return `${court.id}-${court.lat.toFixed(5)}-${court.lon.toFixed(5)}`;
}

function freeCourtIdentities() {
  return new Set(state.courts.map(courtIdentity));
}

function isKnownFreeCourt(court, freeKeys = freeCourtIdentities()) {
  if (freeKeys.has(courtIdentity(court))) {
    return true;
  }

  return state.courts.some((freeCourt) => (
    distanceInMeters([court.lat, court.lon], [freeCourt.lat, freeCourt.lon]) < 35
  ));
}

function normalizedText(value) {
  return String(value || "").toLowerCase();
}

function vipScore(court) {
  let score = 42;
  const surface = normalizedText(court.surface);
  const basketball = normalizedText(court.basketball);
  const access = normalizedText(court.access);

  if (court.hasRealName) {
    score += 14;
  }

  if (court.operator) {
    score += 8;
  }

  if (court.lit) {
    score += 18;
  }

  if (court.covered) {
    score += 14;
  }

  if (court.indoor) {
    score += 10;
  }

  if (court.surface && court.surface !== "surface inconnue") {
    score += 8;
  }

  if (/(tartan|rubber|acrylic|polyurethane|synthetic|sport)/.test(surface)) {
    score += 10;
  } else if (/(asphalt|asphalte|concrete|beton|béton)/.test(surface)) {
    score += 6;
  }

  if (court.hoopCount >= 4) {
    score += 12;
  } else if (court.hoopCount >= 2 || /full|2/.test(basketball)) {
    score += 8;
  } else if (court.hoops && court.hoops !== "basket") {
    score += 5;
  }

  if (court.leisure === "pitch") {
    score += 6;
  }

  if (["yes", "public", "permissive", "customers"].includes(access)) {
    score += 6;
  }

  if (access === "private" || access === "no") {
    score -= 30;
  }

  if (court.fee === "yes") {
    score -= 8;
  }

  if (court.distance > Number(elements.radiusInput.value)) {
    score += 8;
  }

  if (court.distance < 25000) {
    score += 4;
  } else if (court.distance < 70000) {
    score += 3;
  }

  return Math.max(10, Math.min(score, 99));
}

function vipTags(court) {
  return [
    `score ${court.vipScore}`,
    court.lit ? "eclaire" : "",
    court.covered ? "couvert" : "",
    court.indoor ? "indoor" : "",
    court.surface && court.surface !== "surface inconnue" ? court.surface : "",
  ].filter(Boolean).slice(0, 3);
}

function rankedVipCourts(courts) {
  const seen = new Set();
  const freeKeys = freeCourtIdentities();

  return courts
    .filter((court) => Number.isFinite(court.lat) && Number.isFinite(court.lon))
    .filter((court) => !isKnownFreeCourt(court, freeKeys))
    .filter((court) => {
      const key = courtIdentity(court);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((court) => ({ ...court, vipScore: vipScore(court) }))
    .sort((a, b) => b.vipScore - a.vipScore || a.distance - b.distance)
    .slice(0, 5);
}

function setVipListMessage(message) {
  elements.vipList.innerHTML = `<li class="vip-empty">${escapeHtml(message)}</li>`;
}

function renderVipList(courts) {
  const rankedCourts = rankedVipCourts(courts);

  if (rankedCourts.length === 0) {
    setVipListMessage("Aucun terrain VIP distinct des spots gratuits trouve pour cette zone.");
    return;
  }

  elements.vipList.innerHTML = "";
  rankedCourts.forEach((court, index) => {
    const item = document.createElement("li");
    const tags = vipTags(court);
    const displayName = vipDisplayName(court, index);
    item.className = "vip-item";
    item.innerHTML = `
      <button class="vip-court-button" type="button">
        <span class="vip-rank">${index + 1}</span>
        <span class="vip-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <span>${formatRadius(court.distance)} - analyse territoire</span>
        </span>
        <span class="vip-tags">
          ${tags.length ? tags.map((tag) => `<small>${escapeHtml(tag)}</small>`).join("") : "<small>spot</small>"}
        </span>
      </button>
    `;
    item.querySelector(".vip-court-button").addEventListener("click", () => {
      centerCourtAndOpenRoute({ ...court, name: displayName });
    });
    elements.vipList.appendChild(item);
  });

  if (window.lucide) {
    lucide.createIcons();
  }
}

function updateVipShell() {
  elements.vipCard.classList.toggle("is-locked", !state.vipUnlocked);
  elements.vipLocked.hidden = state.vipUnlocked;
  elements.vipContent.hidden = !state.vipUnlocked;
  elements.vipScopeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.vipScope === state.vipScope);
  });
}

async function renderVipCourts() {
  updateVipShell();

  if (!state.vipUnlocked) {
    return;
  }

  const scopeConfig = {
    region: {
      radius: VIP_REGION_RADIUS,
      label: "region",
    },
    territoire: {
      radius: VIP_TERRITORY_RADIUS,
      label: "territoire",
    },
  }[state.vipScope] || {
    radius: VIP_TERRITORY_RADIUS,
    label: "territoire",
  };
  const centerKey = vipCenterKey(state.vipScope);

  if (state.vipCenterKeys[state.vipScope] !== centerKey) {
    state.vipLoading = true;
    state.vipCenterKeys[state.vipScope] = centerKey;
    setVipListMessage(`Analyse VIP du ${scopeConfig.label}...`);

    try {
      state.vipCourts[state.vipScope] = await fetchCourts(
        state.center,
        scopeConfig.radius,
        VIP_COURT_LIMIT
      );
    } catch {
      state.vipCourts[state.vipScope] = [];
    } finally {
      state.vipLoading = false;
    }
  }

  renderVipList(state.vipCourts[state.vipScope]);
}

function activateVipPass() {
  state.vipUnlocked = true;
  localStorage.setItem(VIP_PASS_STORAGE_KEY, "active");
  renderVipCourts();
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
  const searchRunId = state.searchRunId + 1;
  state.searchRunId = searchRunId;
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
    await renderVipCourts();
    fitCourtBounds();

    const sourceLabel = courts.length ? "terrains trouves" : "exemples affiches";
    setStatus(`${state.courts.length} ${sourceLabel} autour de ${label}.`, `${state.courts.length} spots`);

    if (courts.length) {
      void enrichCourtNames(searchRunId, label);
    }
  } catch (error) {
    state.courts = sampleCourts.map((court) => ({
      ...court,
      distance: distanceInMeters(center, [court.lat, court.lon]),
    }));
    renderCourts(state.courts);
    await renderVipCourts();
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
elements.vipUnlockButton.addEventListener("click", activateVipPass);
elements.vipScopeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.vipScope = button.dataset.vipScope;
    renderVipCourts();
  });
});
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
updateVipShell();

window.addEventListener("load", () => {
  lucide.createIcons();
  runSearch(DEFAULT_CENTER, state.lastSearchLabel);
  window.setTimeout(openLocationPrompt, 500);
});
