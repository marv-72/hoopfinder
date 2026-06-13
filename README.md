# Hoopfinder

Hoopfinder est une application web statique pour trouver des terrains de basket a proximite.

## Fonctionnalites

- Geolocalisation du navigateur pour chercher autour de soi.
- Recherche par ville ou adresse via OpenStreetMap Nominatim.
- Carte interactive Leaflet avec terrains issus d'OpenStreetMap via Overpass.
- Rayon de recherche ajustable.
- Build statique pret pour GitHub Pages.

## Lancer le projet

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

GitHub Pages sert la racine de la branche `main` sur `https://marv-72.github.io/hoopsyder/`.
Les chemins de l'application sont relatifs pour fonctionner directement dans ce mode, et le workflow
`.github/workflows/pages.yml` verifie que le build Vite reste valide a chaque push.
