import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import { reverseGeocode, searchPlaces, type GeocodeHit } from "../../lib/geocode";
import { Button } from "../Button";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

export type MapLocationValue = {
  lat: number;
  lng: number;
  address: string;
  city?: string;
  state?: string;
};

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom() > 14 ? map.getZoom() : 15, { animate: true });
  }, [lat, lng, map]);
  return null;
}

type Props = {
  value: MapLocationValue | null;
  onChange: (v: MapLocationValue) => void;
};

export function LocationMapPicker({ value, onChange }: Props) {
  const [mounted, setMounted] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);

  const center = useMemo(() => {
    if (value && Number.isFinite(value.lat) && Number.isFinite(value.lng)) return [value.lat, value.lng] as [number, number];
    return [20.5937, 78.9629] as [number, number];
  }, [value]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const applyHit = useCallback(
    async (h: GeocodeHit) => {
      setBusy(true);
      setSearchErr(null);
      try {
        const rev = await reverseGeocode(h.lat, h.lng);
        const label = rev?.label ?? h.label;
        onChange({
          lat: h.lat,
          lng: h.lng,
          address: label,
          city: rev?.city ?? h.city,
          state: rev?.state ?? h.state,
        });
        setHits([]);
        setSearchQ("");
      } catch {
        onChange({
          lat: h.lat,
          lng: h.lng,
          address: h.label,
          city: h.city,
          state: h.state,
        });
        setHits([]);
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );

  const onSearch = useCallback(async () => {
    setSearchErr(null);
    setBusy(true);
    try {
      const list = await searchPlaces(searchQ);
      setHits(list);
      if (!list.length) setSearchErr("No places found. Try a different search.");
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "Search failed.");
      setHits([]);
    } finally {
      setBusy(false);
    }
  }, [searchQ]);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setSearchErr("Location is not available in this browser.");
      return;
    }
    setGeoBusy(true);
    setSearchErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGeoBusy(false);
        void (async () => {
          const rev = await reverseGeocode(lat, lng);
          onChange({
            lat,
            lng,
            address: rev?.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            city: rev?.city,
            state: rev?.state,
          });
        })();
      },
      () => {
        setGeoBusy(false);
        setSearchErr("Could not read your location. Check permissions.");
      },
      { enableHighAccuracy: true, timeout: 12_000 }
    );
  }, [onChange]);

  const onMarkerDragEnd = useCallback(
    async (lat: number, lng: number) => {
      const rev = await reverseGeocode(lat, lng);
      onChange({
        lat,
        lng,
        address: rev?.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        city: rev?.city,
        state: rev?.state,
      });
    },
    [onChange]
  );

  if (!mounted) {
    return <div className="map-picker map-picker--skeleton" aria-hidden />;
  }

  const lat = value?.lat ?? center[0];
  const lng = value?.lng ?? center[1];

  return (
    <div className="map-picker">
      <div className="map-picker__toolbar">
        <div className="map-picker__search">
          <input
            className="input"
            placeholder="Search place or address"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSearch();
              }
            }}
          />
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void onSearch()}>
            {busy ? "…" : "Search"}
          </Button>
        </div>
        <Button type="button" variant="ghost" disabled={geoBusy} onClick={() => detectLocation()}>
          {geoBusy ? "Locating…" : "Use my location"}
        </Button>
      </div>
      {searchErr ? <p className="error-text small" style={{ margin: "0.35rem 0" }}>{searchErr}</p> : null}
      {hits.length > 0 ? (
        <ul className="map-picker__hits">
          {hits.map((h, i) => (
            <li key={`${h.lat}-${h.lng}-${i}`}>
              <button type="button" className="map-picker__hit" onClick={() => void applyHit(h)}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="map-picker__frame">
        <MapContainer center={[lat, lng]} zoom={value ? 15 : 4} className="map-picker__map" scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker
            position={[lat, lng]}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const m = e.target as L.Marker;
                const p = m.getLatLng();
                void onMarkerDragEnd(p.lat, p.lng);
              },
            }}
          />
          {value ? <Recenter lat={lat} lng={lng} /> : null}
        </MapContainer>
      </div>
      <p className="muted small" style={{ marginTop: "0.5rem" }}>
        Drag the pin to fine-tune. City and region are saved with coordinates for storefront display.
      </p>
    </div>
  );
}
