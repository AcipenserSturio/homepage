// Icons are symbols in the page's sprite, and preferences refer to them by name,
// such as "si:reddit" or "lucide:fish".

const SVG_NS = 'http://www.w3.org/2000/svg';

const symbolId = (name) => `icon-${name.replace(':', '-')}`;

export function spriteIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', name.startsWith('lucide:') ? 'icon line' : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId(name)}`);
  svg.append(use);
  return svg;
}

/** A link's icon, or its first letter if it has none or the build doesn't include it. */
export function iconFor(link) {
  if (link.icon && document.getElementById(symbolId(link.icon))) return spriteIcon(link.icon);
  const letter = document.createElement('span');
  letter.className = 'icon letter';
  letter.setAttribute('aria-hidden', 'true');
  letter.textContent = [...link.name.trim()][0]?.toUpperCase() ?? '?';
  return letter;
}

const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Icon names matching the words typed: exact, then starting with them, then containing them. All if empty. */
export function searchIcons(names, query) {
  const wanted = squash(query);
  if (!wanted) return names;
  return names
    .flatMap((name) => {
      const key = squash(name.slice(name.indexOf(':') + 1));
      const at = key.indexOf(wanted);
      return at < 0 ? [] : [{ name, score: key === wanted ? 0 : at === 0 ? 1 : 2, length: key.length }];
    })
    .sort((a, b) => a.score - b.score || a.length - b.length || a.name.localeCompare(b.name))
    .map((match) => match.name);
}

/** Every icon in the build, read from its sprite. */
export function availableIcons() {
  return [...document.querySelectorAll('#icon-set symbol')].map((symbol) => symbol.id.slice('icon-'.length).replace('-', ':'));
}
