// Build the page's icon sprite. Preferences refer to these by name, such as "si:reddit".
// Symbols carry no paint, so icons take the page's text colour from the .icon rules in
// styles.css. Repeating it on each of Lucide's thousands of symbols would add 200 KB.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BRANDS } from './brands';

const SOURCES = {
  si: 'node_modules/simple-icons/icons',
  lucide: 'node_modules/lucide-static/icons',
  custom: 'src/icons',
} as const;

type Source = keyof typeof SOURCES;

function symbol(source: Source, name: string): string {
  const path = join(process.cwd(), SOURCES[source], `${name}.svg`);
  if (!existsSync(path)) throw new Error(`Unknown icon "${source}:${name}"; check src/brands.ts`);
  const svg = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24';
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*\n\s*/g, '');
  return `<symbol id="icon-${source}-${name}" viewBox="${viewBox}">${inner}</symbol>`;
}

const allIn = (source: Source) =>
  readdirSync(join(process.cwd(), SOURCES[source]))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -'.svg'.length))
    .sort();

/** Brands first, so they come up first in the icon picker when names tie. */
export function renderIconSet(): string {
  return [
    ...BRANDS.map((name) => symbol('si', name)),
    ...allIn('custom').map((name) => symbol('custom', name)),
    ...allIn('lucide').map((name) => symbol('lucide', name)),
  ].join('');
}
