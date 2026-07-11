// Open-Meteo — keyless, CORS-friendly weather + geocoding for the kiosk display.
// No API key, no edge function: the panel fetches directly from the browser.
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Resolve a typed place name → { lat, lon, name }. Returns null for no match.
export async function geocodeCity(query) {
  const q = (query || "").trim();
  if (!q) return null;
  const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
  if (!res.ok) throw new Error("geocode failed");
  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) return null;
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", "),
  };
}

// Current conditions + a short daily forecast for a lat/lon.
export async function fetchWeather(lat, lon, unit = "fahrenheit") {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    temperature_unit: unit,
    wind_speed_unit: unit === "fahrenheit" ? "mph" : "kmh",
    timezone: "auto",
    forecast_days: "4",
  });
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error("weather failed");
  return res.json();
}

// WMO weather code → a coarse condition; `kind` drives the icon, `label` the
// text. `isDay` (0/1) picks the clear/partly day-vs-night variant.
// https://open-meteo.com/en/docs — WMO Weather interpretation codes.
export function weatherInfo(code, isDay = 1) {
  const c = Number(code);
  const day = isDay !== 0;
  if (c === 0) return { label: "Clear", kind: day ? "clear-day" : "clear-night" };
  if (c === 1 || c === 2) return { label: "Partly cloudy", kind: day ? "partly-day" : "partly-night" };
  if (c === 3) return { label: "Overcast", kind: "cloudy" };
  if (c === 45 || c === 48) return { label: "Fog", kind: "fog" };
  if (c >= 51 && c <= 57) return { label: "Drizzle", kind: "drizzle" };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { label: "Rain", kind: "rain" };
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return { label: "Snow", kind: "snow" };
  if (c >= 95) return { label: "Thunderstorm", kind: "storm" };
  return { label: "—", kind: "cloudy" };
}
