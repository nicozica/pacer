export interface RouteMetadata {
  routeSvgPoints: string | null;
  startLat: number | null;
  startLon: number | null;
}

// Decode a Google-encoded polyline string into [lat, lng] pairs.
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let value: number;
    let shift = 0;
    let result = 0;

    do {
      value = encoded.charCodeAt(index++) - 63;
      result |= (value & 0x1f) << shift;
      shift += 5;
    } while (value >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      value = encoded.charCodeAt(index++) - 63;
      result |= (value & 0x1f) << shift;
      shift += 5;
    } while (value >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

function buildRouteSvgPoints(
  points: [number, number][],
  width = 160,
  height = 90,
  step = 4,
): string | null {
  if (points.length < 4) {
    return null;
  }

  const sampled: [number, number][] = [];

  for (let index = 0; index < points.length; index += 1) {
    if (index % step === 0 || index === points.length - 1) {
      sampled.push(points[index]);
    }
  }

  const lats = sampled.map((point) => point[0]);
  const lngs = sampled.map((point) => point[1]);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);
  const latRange = latMax - latMin || 1;
  const lngRange = lngMax - lngMin || 1;

  const pad = 6;
  const drawWidth = width - pad * 2;
  const drawHeight = height - pad * 2;
  const scale = Math.min(drawWidth / lngRange, drawHeight / latRange);
  const offsetX = pad + (drawWidth - lngRange * scale) / 2;
  const offsetY = pad + (drawHeight - latRange * scale) / 2;

  return sampled
    .map(([lat, lng]) => {
      const x = (offsetX + (lng - lngMin) * scale).toFixed(1);
      const y = (offsetY + (latMax - lat) * scale).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');
}

export function buildRouteMetadata(polyline: string | null): RouteMetadata {
  if (!polyline) {
    return {
      routeSvgPoints: null,
      startLat: null,
      startLon: null,
    };
  }

  try {
    const decoded = decodePolyline(polyline);
    const firstPoint = decoded[0] ?? null;

    return {
      routeSvgPoints: buildRouteSvgPoints(decoded),
      startLat: firstPoint ? firstPoint[0] : null,
      startLon: firstPoint ? firstPoint[1] : null,
    };
  } catch {
    return {
      routeSvgPoints: null,
      startLat: null,
      startLon: null,
    };
  }
}
