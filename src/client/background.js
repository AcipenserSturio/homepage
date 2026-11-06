// The page's daily look: a pattern generated from the date, and a hue that moves
// through the colour circle over the week.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The OKLCH hue for a moment: red at the start of Monday, a full circle by the next.
 * The page's head script is made from this function's source, so it can't use anything outside it.
 */
export function weekHue(now = new Date()) {
  const RED_HUE = 29;
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const dayFraction = (now.getHours() * 60 + now.getMinutes()) / 1440;
  return (RED_HUE + (360 * (daysSinceMonday + dayFraction)) / 7) % 360;
}

function seededRandom(text) {
  let state = 0;
  for (const char of text) state = (Math.imul(state ^ char.charCodeAt(0), 0x5bd1e995) + 0x9e3779b9) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Contour-like lines for a date: the same date always gives the same paths. */
export function patternPaths(date, width = 1600, height = 900) {
  const random = seededRandom(date);
  const between = (low, high) => low + (high - low) * random();
  const waves = Array.from({ length: 3 }, () => ({
    amplitude: between(30, 130),
    frequency: between(0.002, 0.009),
    phase: between(0, Math.PI * 2),
    drift: between(0.08, 0.4),
  }));
  const lineCount = Math.round(between(22, 38));
  const tilt = between(-0.18, 0.18);
  return Array.from({ length: lineCount }, (_, line) => {
    const base = (height * (line + 0.5)) / lineCount;
    const points = [];
    for (let x = -20; x <= width + 20; x += 20) {
      const y = waves.reduce(
        (sum, wave) => sum + wave.amplitude * Math.sin(x * wave.frequency + wave.phase + line * wave.drift),
        base + (x - width / 2) * tilt,
      );
      points.push(`${x} ${y.toFixed(1)}`);
    }
    return `M${points.join('L')}`;
  });
}

export function drawPattern(svg, date) {
  svg.replaceChildren(
    ...patternPaths(date).map((path) => {
      const element = document.createElementNS(SVG_NS, 'path');
      element.setAttribute('d', path);
      return element;
    }),
  );
}
