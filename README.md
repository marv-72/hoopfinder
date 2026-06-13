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

Le workflow `.github/workflows/pages.yml` build l'application avec Vite et publie le dossier
`dist` sur GitHub Pages a chaque push sur `main` :
https://marv-72.github.io/hoopfinder/
