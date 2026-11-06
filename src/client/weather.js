// Current weather from Open-Meteo, cached so opening a tab doesn't always hit the network.
// Nothing is requested until you've chosen a location.

const CACHE_KEY = 'homepage.weather';
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_PLACES = 6;

/** Turn a WMO weather code into a label and the name of an icon on the page. */
export function describeWeather(code, isDay) {
  const clear = isDay ? 'sun' : 'moon';
  const partly = isDay ? 'cloud-sun' : 'cloud-moon';
  if (code === 0) return { label: 'Clear', icon: clear };
  if (code === 1) return { label: 'Mostly clear', icon: clear };
  if (code === 2) return { label: 'Partly cloudy', icon: partly };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'cloud-fog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'cloud-drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'cloud-rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'cloud-snow' };
  if (code >= 95 && code <= 99) return { label: 'Thunderstorm', icon: 'cloud-lightning' };
  return { label: '', icon: 'cloud' };
}

export function forecastUrl({ latitude, longitude }) {
  const query = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,weather_code,is_day',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

export function placesUrl(name) {
  const query = new URLSearchParams({ name, count: MAX_PLACES, language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${query}`;
}

/** A place as a person would tell it apart from others of the same name. */
export function describePlace({ name, admin1, country }) {
  return [name, admin1 === name ? null : admin1, country].filter(Boolean).join(', ');
}

export async function findPlaces(name) {
  const response = await fetch(placesUrl(name));
  if (!response.ok) throw new Error(`Place search failed: ${response.status}`);
  return (await response.json()).results ?? [];
}

function render(root, current, place) {
  const { label, icon } = describeWeather(current.weather_code, current.is_day === 1);
  root.querySelector('use').setAttribute('href', `#icon-lucide-${icon}`);
  root.querySelector('.temperature').textContent = `${Math.round(current.temperature_2m)}°`;
  root.querySelector('.condition').textContent = [label, place].filter(Boolean).join(' · ');
  root.hidden = false;
}

function readCache(place) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cached?.latitude === place.latitude && cached?.longitude === place.longitude ? cached : null;
  } catch {
    return null;
  }
}

let latestRequest = 0;

/** Show cached weather straight away and refresh it if it's old. Hidden when there's nothing to show. */
export async function loadWeather(root, place) {
  const request = ++latestRequest;
  root.hidden = true;
  if (!place) return;
  const cached = readCache(place);
  if (cached?.current) render(root, cached.current, place.name);
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return;
  try {
    const response = await fetch(forecastUrl(place));
    if (!response.ok) return;
    const { current } = await response.json();
    // The location may have changed while this was on its way.
    if (request !== latestRequest) return;
    const entry = { fetchedAt: Date.now(), latitude: place.latitude, longitude: place.longitude, current };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    render(root, current, place.name);
  } catch {
    // Offline: keep whatever is showing.
  }
}
