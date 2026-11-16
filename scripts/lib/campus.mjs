// Shared campus constants for the data scripts.

// Fetch window. Covers Ring Road and everything inside it, the residences to
// the west and north (REV, V1, MKV, CLV south edge), the affiliated colleges,
// East Campus across the rail line, and the University Ave frontage.
export const CAMPUS_BBOX = {
  south: 43.463,
  west: -80.56,
  north: 43.479,
  east: -80.533,
};

// Origin of the local metric frame (roughly the middle of Ring Road).
// x = metres east, y = metres north of this point.
export const CAMPUS_ORIGIN = { lat: 43.4715, lon: -80.5445 };

const R = 6378137;
const D2R = Math.PI / 180;
const cosLat0 = Math.cos(CAMPUS_ORIGIN.lat * D2R);

// Local equirectangular projection. Over a ~2 km campus the error against a
// true transverse Mercator is a few centimetres, well under OSM's own accuracy.
export function project(lat, lon) {
  return [
    (lon - CAMPUS_ORIGIN.lon) * D2R * R * cosLat0,
    (lat - CAMPUS_ORIGIN.lat) * D2R * R,
  ];
}

export function unproject(x, y) {
  return [
    CAMPUS_ORIGIN.lat + y / R / D2R,
    CAMPUS_ORIGIN.lon + x / (R * cosLat0) / D2R,
  ];
}
