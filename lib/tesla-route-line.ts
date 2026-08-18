function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let index = start;
  while (index < bytes.length && shift < 35) {
    const byte = bytes[index++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, index];
    shift += 7;
  }
  throw new Error("Invalid RouteLine protobuf varint");
}

function extractPolyline(bytes: Uint8Array): string {
  try {
    const [tag, afterTag] = readVarint(bytes, 0);
    if (tag === 10) {
      const [length, afterLength] = readVarint(bytes, afterTag);
      const end = afterLength + length;
      if (end <= bytes.length) {
        return new TextDecoder().decode(bytes.slice(afterLength, end));
      }
    }
  } catch {
    // Older payloads can contain the encoded polyline directly.
  }
  return new TextDecoder().decode(bytes);
}

function decodeValue(value: string, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte: number;
  do {
    if (index >= value.length) throw new Error("Truncated encoded polyline");
    byte = value.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return [(result & 1) !== 0 ? ~(result >> 1) : result >> 1, index];
}

export function decodeTeslaRouteLine(encoded: string): [number, number][] {
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  const polyline = extractPolyline(bytes);
  const coordinates: [number, number][] = [];
  let latitude = 0;
  let longitude = 0;
  let index = 0;

  while (index < polyline.length) {
    const [latitudeDelta, afterLatitude] = decodeValue(polyline, index);
    const [longitudeDelta, afterLongitude] = decodeValue(
      polyline,
      afterLatitude
    );
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    index = afterLongitude;
    coordinates.push([longitude / 1_000_000, latitude / 1_000_000]);
  }

  if (coordinates.length < 2) {
    throw new Error("Tesla RouteLine did not contain a usable route");
  }
  return coordinates;
}
