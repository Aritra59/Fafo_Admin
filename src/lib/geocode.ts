export type GeocodeHit = {
  lat: number;
  lng: number;
  label: string;
  city?: string;
  state?: string;
  country?: string;
  street?: string;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
};

function propsLine(p: Record<string, string | number | undefined> | undefined): GeocodeHit | null {
  if (!p) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = String(p.name ?? "");
  const street = String(p.street ?? "");
  const city = String(p.city ?? p.town ?? p.district ?? "");
  const state = String(p.state ?? "");
  const country = String(p.country ?? "");
  const parts = [name, street, city, state, country].filter(Boolean);
  const label = parts.length ? parts.join(", ") : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return { lat, lng, label, city: city || undefined, state: state || undefined, country: country || undefined, street: street || undefined };
}

export async function searchPlaces(query: string): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search failed. Try again.");
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const out: GeocodeHit[] = [];
  for (const f of data.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    const hit = propsLine({ ...f.properties, lat, lon: lng });
    if (hit) out.push(hit);
  }
  return out;
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeHit | null> {
  const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const f = data.features?.[0];
  if (!f?.geometry?.coordinates) return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
  const [flng, flat] = f.geometry.coordinates;
  const hit = propsLine({ ...f.properties, lat: flat, lon: flng });
  return hit ?? { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
}
