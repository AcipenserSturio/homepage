// Checks on the built page. `npm test` builds first.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { defaultPreferences } from '../src/client/defaults.js';

const DIST = new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', DIST), 'utf8');

test('the build is one self-contained file', () => {
  assert.deepEqual(readdirSync(DIST).filter((name) => !name.startsWith('.')), ['index.html']);
  assert.doesNotMatch(html, /<script[^>]+\ssrc=/);
  assert.doesNotMatch(html, /<link[^>]+rel="?stylesheet/);
  assert.match(html, /<style/);
});

test('the build draws no links itself, and has no location', () => {
  assert.doesNotMatch(html, /class="tile/);
  assert.doesNotMatch(html, /class="group"/);
  assert.doesNotMatch(html, /\b(latitude|longitude): ?-?\d/);
});

const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');
const defaultHosts = new Set(defaultPreferences.groups.flatMap((group) => group.links.map((link) => hostOf(link.url))));

// my-preferences.json is kept outside this repo, so these checks only run where it's present.
// Its names stay out of this test too.
const PERSONAL = new URL('../../my-preferences.json', import.meta.url);
test('of your preferences, only sites also in the defaults reached the build', { skip: !existsSync(PERSONAL) }, () => {
  const { groups, location } = JSON.parse(readFileSync(PERSONAL, 'utf8'));
  const defaultGroups = new Set(defaultPreferences.groups.map((group) => group.name));
  // The bang list is DuckDuckGo's public top 500, so a site being in it says nothing about you.
  const bangs = readFileSync(new URL('../src/client/bangs.json', import.meta.url), 'utf8');
  for (const group of groups) {
    if (!defaultGroups.has(group.name)) assert.ok(!html.includes(group.name), group.name);
    for (const link of group.links) {
      const host = link.url && hostOf(link.url);
      if (host && !defaultHosts.has(host) && !bangs.includes(host)) assert.ok(!html.includes(host), link.url);
    }
  }
  assert.ok(!html.includes(location.name), location.name);
});

test('every icon in the defaults is in the build', () => {
  for (const link of defaultPreferences.groups.flatMap((group) => group.links)) {
    assert.ok(html.includes(`id="icon-${link.icon.replace(':', '-')}"`), link.icon);
  }
});

test('the top bangs are in the page, and can only lead to web addresses', () => {
  const bangs = JSON.parse(readFileSync(new URL('../src/client/bangs.json', import.meta.url), 'utf8'));
  const entries = Object.entries(bangs);
  assert.equal(entries.length, 500);
  assert.match(bangs.w[1], /wikipedia/);
  assert.ok(html.includes(bangs.w[1]));
  for (const [trigger, [site, template]] of entries) {
    assert.equal(trigger, trigger.toLowerCase());
    assert.equal(typeof site, 'string', trigger);
    assert.match(template, /^https?:\/\//i, trigger);
    assert.doesNotMatch(template, /kagi\.com/, trigger);
  }
});

test('the corner links to the source', () => {
  assert.match(html, /<a class="repo-corner" href="https:\/\/github\.com\/AcipenserSturio\/homepage"/);
});

test('the weather is credited on hover', () => {
  assert.match(html, /<span id="weather"[^>]*title="[^"]*Open-Meteo[^"]*CC BY 4\.0/);
});

test('the head describes the page at its address', () => {
  const head = html.slice(0, html.indexOf('<body'));
  assert.match(head, /<link rel="canonical" href="https:\/\/home\.asi\.fish\/"/);
  assert.match(head, /<meta property="og:url" content="https:\/\/home\.asi\.fish\/"/);
  assert.match(head, /<meta name="description" content="[^"]+"/);
  assert.match(head, /<meta property="og:title"/);
  assert.match(head, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml/);
});

test('every icon in your preferences file is in the build', { skip: !existsSync(PERSONAL) }, () => {
  const { groups } = JSON.parse(readFileSync(PERSONAL, 'utf8'));
  for (const link of groups.flatMap((group) => group.links)) {
    if (link.icon) assert.ok(html.includes(`id="icon-${link.icon.replace(':', '-')}"`), link.icon);
  }
});

test('icons carry no colour of their own', () => {
  const symbols = html.match(/<symbol[\s\S]*?<\/symbol>/g) ?? [];
  assert.ok(symbols.length > 2000, `${symbols.length} symbols`);
  for (const symbol of symbols) assert.doesNotMatch(symbol, /(fill|stroke)="(#|rgb)/);
  for (const icon of ['si:github', 'lucide:fish', 'custom:lipu', 'custom:nimi', 'custom:ilo']) {
    assert.ok(html.includes(`id="icon-${icon.replace(':', '-')}"`), icon);
  }
});

test('the tint is set before the page can paint, and the page stays hidden until drawn', () => {
  const head = html.slice(0, html.indexOf('<body'));
  assert.match(head, /<script>document\.documentElement\.style\.setProperty\('--hue'/);
  assert.match(html, /html:not\(\.drawn\) body\s*\{\s*visibility:\s*hidden/);
});

test('search is DuckDuckGo, with an icon rather than a placeholder', () => {
  assert.ok(html.includes('https://duckduckgo.com/?q='));
  assert.doesNotMatch(html, /placeholder=/);
  assert.match(html, /<form id="search"[\s\S]*?href="#icon-lucide-search"[\s\S]*?<\/form>/);
});

test('the page can only talk to the weather service', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src https:\/\/api\.open-meteo\.com https:\/\/geocoding-api\.open-meteo\.com(;|$)/);
});

test('toki pona glyphs are single-colour and cropped', () => {
  const glyphs = readdirSync(new URL('../src/icons/', import.meta.url)).filter((file) => file.endsWith('.svg')).map((file) => file.replace('.svg', ''));
  assert.ok(glyphs.length > 100, `${glyphs.length} glyphs`);
  for (const name of glyphs) {
    const svg = readFileSync(new URL(`../src/icons/${name}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /viewBox="-?\d+ -?\d+ \d+ \d+"/, name);
    assert.doesNotMatch(svg, /fill=|stroke=|<\?xml/, name);
  }
});
