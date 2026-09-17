/**
 * MapLibre style for the self-hosted OpenMapTiles-schema tiles (built by Planetiler).
 * No sprite sheet: POIs are drawn as circles so the style only needs glyphs.
 */

interface Palette {
  background: string;
  water: string;
  waterLine: string;
  park: string;
  wood: string;
  grass: string;
  sand: string;
  residential: string;
  building: string;
  buildingOutline: string;
  motorway: string;
  trunk: string;
  primary: string;
  secondary: string;
  minor: string;
  path: string;
  casing: string;
  rail: string;
  boundary: string;
  label: string;
  labelHalo: string;
  roadLabel: string;
  waterLabel: string;
  poi: string;
}

const LIGHT: Palette = {
  background: '#f3efe6',
  water: '#a9d3e6',
  waterLine: '#8cc2da',
  park: '#cfe3b8',
  wood: '#bcd8a4',
  grass: '#dcebc6',
  sand: '#f0e4c2',
  residential: '#ece6da',
  building: '#e0d8cb',
  buildingOutline: '#d2c8b8',
  motorway: '#f0a35e',
  trunk: '#f4bd6f',
  primary: '#f8d58c',
  secondary: '#fbe7b0',
  minor: '#ffffff',
  path: '#a58c6f',
  casing: '#cbbda8',
  rail: '#b7ab9b',
  boundary: '#9c8fb0',
  label: '#3d3a33',
  labelHalo: '#f8f5ee',
  roadLabel: '#5d574c',
  waterLabel: '#3f7894',
  poi: '#b5653f',
};

const DARK: Palette = {
  background: '#1d2126',
  water: '#1f3a4d',
  waterLine: '#2b4d63',
  park: '#233526',
  wood: '#203322',
  grass: '#26352a',
  sand: '#3a3528',
  residential: '#23272c',
  building: '#2d3238',
  buildingOutline: '#363c43',
  motorway: '#a8703f',
  trunk: '#8f6a3f',
  primary: '#77643f',
  secondary: '#5a5240',
  minor: '#3b4047',
  path: '#8c7a62',
  casing: '#15181b',
  rail: '#4d535a',
  boundary: '#6d6385',
  label: '#e3ded3',
  labelHalo: '#1d2126',
  roadLabel: '#c3bcae',
  waterLabel: '#86b6cf',
  poi: '#d9895f',
};

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

const zoomWidth = (stops: Array<[number, number]>) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];

export function buildStyle(origin: string, theme: 'light' | 'dark') {
  const p = theme === 'dark' ? DARK : LIGHT;
  const roadClass = (classes: string[]) => ['in', ['get', 'class'], ['literal', classes]];
  const road = (id: string, classes: string[], color: string, widths: Array<[number, number]>, minzoom = 5) => [
    {
      id: `${id}-casing`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: Math.max(minzoom, 10),
      filter: ['all', roadClass(classes), ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.casing, 'line-width': zoomWidth(widths.map(([z, w]) => [z, w + 1.5])) },
    },
    {
      id,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom,
      filter: ['all', roadClass(classes), ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': zoomWidth(widths) },
    },
  ];

  return {
    version: 8,
    name: `Wayfinder ${theme}`,
    glyphs: `${origin}/map/assets/fonts/{fontstack}/{range}.pbf`,
    sources: {
      openmaptiles: { type: 'vector', url: `${origin}/tiles/tiles.json` },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': p.background } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
        paint: { 'fill-color': p.residential },
      },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': p.wood, 'fill-opacity': 0.8 },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]],
        paint: { 'fill-color': p.grass, 'fill-opacity': 0.6 },
      },
      {
        id: 'landcover-sand',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'sand'],
        paint: { 'fill-color': p.sand },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': p.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': p.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: { 'line-color': p.waterLine, 'line-width': zoomWidth([[8, 0.5], [14, 2], [18, 6]]) },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingOutline },
      },
      {
        id: 'boundary-state',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': p.boundary, 'line-dasharray': [3, 2], 'line-width': 1 },
      },
      {
        id: 'path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        paint: { 'line-color': p.path, 'line-dasharray': [2, 1.5], 'line-width': zoomWidth([[13, 0.8], [18, 2.5]]) },
      },
      ...road('road-minor', ['minor', 'service'], p.minor, [[12, 0.5], [14, 2], [18, 14]], 12),
      ...road('road-secondary', ['secondary', 'tertiary'], p.secondary, [[8, 0.5], [12, 1.5], [18, 18]], 8),
      ...road('road-primary', ['primary'], p.primary, [[7, 0.5], [12, 2], [18, 22]], 7),
      ...road('road-trunk', ['trunk'], p.trunk, [[5, 0.5], [12, 2.5], [18, 24]], 5),
      ...road('road-motorway', ['motorway'], p.motorway, [[4, 0.5], [12, 3], [18, 26]], 4),
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': p.rail, 'line-width': zoomWidth([[10, 0.5], [16, 2]]) },
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT_ITALIC, 'text-size': 12 },
        paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14],
        },
        paint: { 'text-color': p.roadLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'poi',
        type: 'circle',
        source: 'openmaptiles',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['<=', ['get', 'rank'], 20],
        paint: { 'circle-color': p.poi, 'circle-radius': 3.5, 'circle-stroke-color': p.labelHalo, 'circle-stroke-width': 1 },
      },
      {
        id: 'poi-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'poi',
        minzoom: 15,
        filter: ['<=', ['get', 'rank'], 20],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
          'text-optional': true,
        },
        paint: { 'text-color': p.poi, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'peak',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'mountain_peak',
        minzoom: 11,
        layout: { 'text-field': ['concat', '▲ ', ['get', 'name']], 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'place-suburb',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'village', 'hamlet']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 15],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'place-town',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['town', 'city']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, ['match', ['get', 'class'], 'city', 13, 11], 14, 20],
        },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 2 },
      },
      {
        id: 'place-state',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'state'],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 13, 'text-transform': 'uppercase' },
        paint: { 'text-color': p.boundary, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
    ],
  };
}
