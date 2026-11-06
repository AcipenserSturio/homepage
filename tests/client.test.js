import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localDate, patternPaths, weekHue } from '../src/client/background.js';
import { resolveBang } from '../src/client/bangs.js';
import { columnLayout, estimatedHeight, partition, rowSizes } from '../src/client/columns.js';
import { defaultPreferences } from '../src/client/defaults.js';
import { buildRows, displayAddress, findCompletion, matchLinks, toUrl } from '../src/client/search.js';
import { edgeScroll, nearestRect, positionInColumns, positionInGrid } from '../src/client/drag.js';
import { searchIcons } from '../src/client/icons.js';
import {
  addGroup,
  countLinks,
  emptyPreferences,
  loadPreferences,
  moveGroupTo,
  normalizePreferences,
  parsePreferences,
  placeLink,
  removeGroup,
  removeLink,
  renameGroup,
  savePreferences,
  serializePreferences,
  setLocation,
  webAddress,
} from '../src/client/preferences.js';
import { describePlace, describeWeather, forecastUrl, placesUrl } from '../src/client/weather.js';

const LINKS = [
  { name: 'Redwood', url: 'https://www.redwood.example' },
  { name: 'Docs', url: 'https://docs.gocloud.example/document/u/0/' },
  { name: 'Sheets', url: 'https://docs.gocloud.example/spreadsheets/u/0/' },
  { name: 'Maps', url: 'https://www.gocloud.example/maps' },
  { name: 'Alpine Wiki', url: 'https://wiki.alpine.example' },
  { name: 'Block Wiki', url: 'https://block.wiki.example' },
];
const SEARCH = 'https://search.example/?q=';

test('toUrl recognises what an address bar would open', () => {
  const cases = {
    'example.com': 'https://example.com',
    'example.com/a/b?c=d': 'https://example.com/a/b?c=d',
    'sub.example.co.uk:8443/x': 'https://sub.example.co.uk:8443/x',
    'http://example.com': 'http://example.com',
    'HTTPS://example.com': 'HTTPS://example.com',
    localhost: 'http://localhost',
    'localhost:4321/page': 'http://localhost:4321/page',
    '192.168.0.10:8080': 'http://192.168.0.10:8080',
    '[::1]:3000': 'http://[::1]:3000',
    '  example.com  ': 'https://example.com',
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(toUrl(text), expected, text);
});

test('toUrl leaves everything else to search', () => {
  const searches = [
    '',
    '   ',
    'hello',
    'hello world',
    'what is example.com',
    'example.com is down',
    '3.14',
    'node.js',
    'readme.md',
    'someone@example.com',
    'javascript:alert(1)',
    'javascript://example.com/%0aalert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'http://',
  ];
  for (const text of searches) assert.equal(toUrl(text), null, text);
});

test('displayAddress reads as typed', () => {
  assert.equal(displayAddress('https://www.redwood.example/'), 'redwood.example');
  assert.equal(displayAddress('http://plain.example/cube/index.pl'), 'plain.example/cube/index.pl');
  assert.equal(displayAddress('https://docs.gocloud.example/document/u/0/'), 'docs.gocloud.example/document/u/0');
});

test('matchLinks ranks name prefix, address prefix, word start, then substring', () => {
  const names = (text) => matchLinks(text, LINKS).map((link) => link.name);
  assert.deepEqual(names('red'), ['Redwood']);
  assert.deepEqual(names('re'), ['Redwood', 'Sheets'], 'substring of an address counts last');
  assert.deepEqual(names('docs'), ['Docs', 'Sheets']);
  assert.deepEqual(names('wiki'), ['Alpine Wiki', 'Block Wiki']);
  assert.deepEqual(names('MAPS'), ['Maps']);
  assert.deepEqual(names('  '), []);
  assert.deepEqual(names('zzz'), []);
});

test('findCompletion autofills from addresses only', () => {
  assert.equal(findCompletion('red', LINKS).address, 'redwood.example');
  assert.equal(findCompletion('docs', LINKS).address, 'docs.gocloud.example/document/u/0');
  assert.equal(findCompletion('go', LINKS).address, 'gocloud.example/maps');
  assert.equal(findCompletion('Red', LINKS).link.name, 'Redwood');
  assert.equal(findCompletion('r', LINKS), null, 'one letter is too little');
  assert.equal(findCompletion('red dit', LINKS), null);
  assert.equal(findCompletion('sheets', LINKS), null, 'names are suggested, not autofilled');
});

test('first row is what Enter does', () => {
  const first = (text, completion) => buildRows(text, LINKS, SEARCH, 'Search', completion)[0];
  assert.deepEqual(first('red', findCompletion('red', LINKS)), {
    kind: 'link',
    label: 'Redwood',
    detail: 'redwood.example',
    href: 'https://www.redwood.example',
  });
  assert.equal(first('example.com').kind, 'url');
  assert.equal(first('example.com').href, 'https://example.com');
  assert.equal(first('a b&c').kind, 'search');
  assert.equal(first('a b&c').href, `${SEARCH}a%20b%26c`);
  // Without a completion (after deleting it), Enter must search rather than jump to a link.
  assert.equal(first('redwood').kind, 'search');
  assert.deepEqual(buildRows('  ', LINKS, SEARCH, 'Search'), []);
});

test('search stays reachable and links are not repeated', () => {
  const rows = buildRows('docs', LINKS, SEARCH, 'Search', findCompletion('docs', LINKS));
  assert.deepEqual(
    rows.map((row) => [row.kind, row.label]),
    [
      ['link', 'Docs'],
      ['link', 'Sheets'],
      ['search', 'docs'],
    ],
  );
});

test('the hue starts each Monday at red and goes once round over the week', () => {
  const RED = 29;
  const monday = new Date(2026, 10, 2, 0, 0); // 2 November 2026
  assert.equal(monday.getDay(), 1);
  assert.equal(weekHue(monday), RED);
  assert.equal(weekHue(new Date(2026, 10, 9, 0, 0)), RED);
  assert.ok(Math.abs(weekHue(new Date(2026, 10, 5, 12, 0)) - (RED + 180)) < 1e-9, 'halfway through Thursday');
  const endOfSunday = weekHue(new Date(2026, 10, 8, 23, 59));
  assert.ok(endOfSunday > RED - 0.1 && endOfSunday < RED, `just short of red again: ${endOfSunday}`);
  for (let day = 0; day < 7; day += 1) {
    const hue = weekHue(new Date(2026, 10, 2 + day, 6, 30));
    assert.ok(hue >= 0 && hue < 360, String(hue));
  }
});

test('columns hold whole tiles, with spare width left outside them', () => {
  const layout = (available, groups = 8, mostTiles = 9) =>
    columnLayout({ available, tile: 100, tileGap: 2, pad: 10, gap: 10, groups, mostTiles });
  // Three tiles need 324 wide, so 1680 fits five columns, each with room for three.
  assert.deepEqual(layout(1680), { count: 5, tilesAcross: 3, width: 324 });
  // A bit more room per column than three tiles need isn't enough for a fourth.
  assert.deepEqual(layout(800), { count: 2, tilesAcross: 3, width: 324 });
  assert.deepEqual(layout(900), { count: 2, tilesAcross: 4, width: 426 });
  assert.equal(layout(500).count, 2, 'at least two');
  assert.deepEqual(layout(1680, 3), { count: 3, tilesAcross: 5, width: 528 }, 'no empty columns, so more room for each');
  assert.deepEqual(layout(1680, 3, 4), { count: 3, tilesAcross: 4, width: 426 }, 'no wider than the largest group needs');
  assert.deepEqual(layout(1680, 3, 1), { count: 3, tilesAcross: 3, width: 324 }, 'room for a group header, however small the groups');
  assert.deepEqual(layout(1680, 0, 0).count, 0);
});

test('a group is estimated as taller for each extra row of tiles', () => {
  assert.equal(estimatedHeight(3, 3), estimatedHeight(1, 3), 'one row either way');
  assert.ok(estimatedHeight(4, 3) > estimatedHeight(3, 3));
  assert.equal(estimatedHeight(7, 3), estimatedHeight(9, 3), 'three rows either way');
  assert.ok(estimatedHeight(0, 3) > 0, 'an empty group still has its header');
  assert.ok(estimatedHeight(0, 3) < estimatedHeight(1, 3));
});

test('partition keeps order and makes the tallest column as short as possible', () => {
  assert.deepEqual(partition([1, 1, 1, 1], 2), [[0, 1], [2, 3]]);
  assert.deepEqual(partition([5, 1, 1, 1, 5], 3), [[0], [1, 2, 3], [4]]);
  assert.deepEqual(partition([1, 1, 1], 3), [[0], [1], [2]]);
  assert.deepEqual(partition([9, 1, 1], 2), [[0], [1, 2]]);
  // The gap counts: at 10 apiece, 3+1 stacks would be 50 tall against 30+.
  assert.deepEqual(partition([10, 10, 10, 10], 2, 100), [[0, 1], [2, 3]]);
});

test('partition covers every group exactly once with no empty column', () => {
  const heights = [120, 190, 110, 110, 190, 130, 110, 180];
  for (let count = 2; count <= heights.length; count += 1) {
    const columns = partition(heights, count, 12);
    assert.equal(columns.length, count);
    assert.ok(columns.every((column) => column.length > 0));
    assert.deepEqual(columns.flat(), heights.map((_, index) => index));
  }
});

test('pattern is stable for a date and differs between dates', () => {
  assert.deepEqual(patternPaths('2026-11-06'), patternPaths('2026-11-06'));
  assert.notDeepEqual(patternPaths('2026-11-06'), patternPaths('2026-11-07'));
  for (const path of patternPaths('2026-11-06')) assert.doesNotMatch(path, /NaN|undefined/);
});

test('localDate uses the local calendar', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('every weather code maps to a label and icon', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Clear', icon: 'sun' });
  assert.deepEqual(describeWeather(0, false), { label: 'Clear', icon: 'moon' });
  assert.deepEqual(describeWeather(2, false), { label: 'Partly cloudy', icon: 'cloud-moon' });
  assert.deepEqual(describeWeather(3, true), { label: 'Overcast', icon: 'cloud' });
  assert.equal(describeWeather(48, true).icon, 'cloud-fog');
  assert.equal(describeWeather(55, true).icon, 'cloud-drizzle');
  assert.equal(describeWeather(65, true).icon, 'cloud-rain');
  assert.equal(describeWeather(81, true).icon, 'cloud-rain');
  assert.equal(describeWeather(75, true).icon, 'cloud-snow');
  assert.equal(describeWeather(86, true).icon, 'cloud-snow');
  assert.equal(describeWeather(96, true).icon, 'cloud-lightning');
  assert.deepEqual(describeWeather(1234, true), { label: '', icon: 'cloud' });
});

test('forecast request carries the place', () => {
  const url = new URL(forecastUrl({ latitude: 41.69, longitude: 44.83 }));
  assert.equal(url.searchParams.get('latitude'), '41.69');
  assert.equal(url.searchParams.get('longitude'), '44.83');
  assert.match(url.searchParams.get('current'), /weather_code/);
});

test('places are told apart, and the search names what was typed', () => {
  assert.equal(describePlace({ name: 'Paris', admin1: 'Texas', country: 'United States' }), 'Paris, Texas, United States');
  assert.equal(describePlace({ name: 'Tokyo', admin1: 'Tokyo', country: 'Japan' }), 'Tokyo, Japan');
  assert.equal(describePlace({ name: 'Somewhere' }), 'Somewhere');
  assert.equal(new URL(placesUrl('São Paulo')).searchParams.get('name'), 'São Paulo');
});

const SAMPLE = {
  version: 1,
  location: { name: 'Exampleville', latitude: 10.5, longitude: -20.25 },
  groups: [
    {
      name: 'One',
      links: [
        { name: 'A', url: 'https://a.example/', icon: 'si:github' },
        { name: 'B', url: '', icon: '' },
      ],
    },
    { name: 'Two', links: [{ name: 'C', url: 'http://c.example/x?y=1', icon: 'lucide:fish' }] },
    { name: 'Three', links: [] },
  ],
};

test('preferences survive a round trip through a file', () => {
  assert.deepEqual(parsePreferences(serializePreferences(SAMPLE)), SAMPLE);
  assert.equal(countLinks(SAMPLE), 3);
});

test('import rejects anything that could run or misbehave', () => {
  const withLink = (link) => ({ version: 1, groups: [{ name: 'G', links: [link] }] });
  const bad = {
    'javascript address': withLink({ name: 'x', url: 'javascript:alert(1)' }),
    'data address': withLink({ name: 'x', url: 'data:text/html,hi' }),
    'file address': withLink({ name: 'x', url: 'file:///etc/passwd' }),
    'mixed-case javascript': withLink({ name: 'x', url: 'JaVaScRiPt:alert(1)' }),
    'leading-space javascript': withLink({ name: 'x', url: ' javascript:alert(1)' }),
    'no scheme': withLink({ name: 'x', url: 'example.com' }),
    'address not text': withLink({ name: 'x', url: { toString: 'y' } }),
    'markup in icon': withLink({ name: 'x', url: '', icon: '<svg onload="alert(1)"/>' }),
    'id trick in icon': withLink({ name: 'x', url: '', icon: 'si:a" onload="b' }),
    'name not text': withLink({ name: 5, url: '' }),
    'name too long': withLink({ name: 'n'.repeat(201), url: '' }),
    'link not object': withLink('nope'),
    'wrong version': { version: 2, groups: [] },
    'no groups': { version: 1 },
    'groups not list': { version: 1, groups: {} },
    'group without links': { version: 1, groups: [{ name: 'G' }] },
    'null group': { version: 1, groups: [null] },
    'bad latitude': { version: 1, location: { name: 'x', latitude: 91, longitude: 0 }, groups: [] },
    'text coordinates': { version: 1, location: { name: 'x', latitude: '1', longitude: 0 }, groups: [] },
    null: null,
    list: [],
  };
  for (const [name, value] of Object.entries(bad)) assert.throws(() => normalizePreferences(value), Error, name);
  assert.throws(() => parsePreferences('not json'), /valid JSON/);
});

test('import keeps only known fields', () => {
  const result = normalizePreferences({
    version: 1,
    extra: 'x',
    groups: [{ name: 'G', other: 1, links: [{ name: 'L', url: 'https://l.example/', other: 2 }] }],
  });
  assert.deepEqual(result, { version: 1, location: null, groups: [{ name: 'G', links: [{ name: 'L', url: 'https://l.example/', icon: '' }] }] });
});

test('typed addresses become stored ones', () => {
  assert.equal(webAddress('example.com'), 'https://example.com');
  assert.equal(webAddress(' http://a.example/b '), 'http://a.example/b');
  assert.equal(webAddress(''), '');
  assert.equal(webAddress('   '), '');
  assert.equal(webAddress('not an address'), null);
  assert.equal(webAddress('javascript:alert(1)'), null);
  assert.equal(webAddress('javascript://example.com/%0aalert(1)'), null);
  assert.equal(webAddress('ftp://example.com/a'), null);
});

test('storage: empty, round trip, corrupt, and failing', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.deepEqual(loadPreferences(storage), emptyPreferences());
  assert.equal(loadPreferences(storage, SAMPLE), SAMPLE, 'nothing saved yet: the defaults');
  assert.equal(savePreferences(storage, SAMPLE), true);
  assert.deepEqual(loadPreferences(storage), SAMPLE);
  store.set('homepage.preferences', '{broken');
  assert.deepEqual(loadPreferences(storage), emptyPreferences());
  store.set('homepage.preferences', JSON.stringify(withBadLink()));
  assert.deepEqual(loadPreferences(storage), emptyPreferences());
  const full = { setItem() { throw new Error('quota'); } };
  assert.equal(savePreferences(full, SAMPLE), false);
});

function withBadLink() {
  return { version: 1, groups: [{ name: 'G', links: [{ name: 'x', url: 'javascript:alert(1)' }] }] };
}

test('edits change a copy and leave the original alone', () => {
  const before = JSON.stringify(SAMPLE);
  const names = (preferences) => preferences.groups.map((group) => group.name);
  const linkNames = (preferences, group) => preferences.groups[group].links.map((link) => link.name);
  assert.deepEqual(names(addGroup(SAMPLE, 'New')), ['One', 'Two', 'Three', 'New']);
  assert.deepEqual(names(renameGroup(SAMPLE, 1, 'Renamed')), ['One', 'Renamed', 'Three']);
  assert.deepEqual(names(removeGroup(SAMPLE, 0)), ['Two', 'Three']);
  assert.deepEqual(names(moveGroupTo(SAMPLE, 0, 1)), ['Two', 'One', 'Three']);
  assert.deepEqual(names(moveGroupTo(SAMPLE, 0, 2)), ['Two', 'Three', 'One']);
  assert.deepEqual(names(moveGroupTo(SAMPLE, 2, 1)), ['One', 'Three', 'Two']);
  assert.equal(moveGroupTo(SAMPLE, 0, -1), SAMPLE, 'nothing before the first');
  assert.equal(moveGroupTo(SAMPLE, 2, 3), SAMPLE, 'nothing after the last');
  assert.deepEqual(linkNames(removeLink(SAMPLE, 0, 0), 0), ['B']);
  assert.equal(setLocation(SAMPLE, null).location, null);
  assert.equal(JSON.stringify(SAMPLE), before);
});

test('placeLink adds, reorders, moves between groups and updates in place', () => {
  const names = (preferences, group) => preferences.groups[group].links.map((link) => link.name);
  const link = { name: 'N', url: '', icon: '' };
  assert.deepEqual(names(placeLink(SAMPLE, link, 0, 2), 0), ['A', 'B', 'N']);
  assert.deepEqual(names(placeLink(SAMPLE, link, 0, 0), 0), ['N', 'A', 'B']);
  assert.deepEqual(names(placeLink(SAMPLE, SAMPLE.groups[0].links[0], 0, 1, { group: 0, link: 0 }), 0), ['B', 'A']);
  const moved = placeLink(SAMPLE, SAMPLE.groups[0].links[0], 1, 0, { group: 0, link: 0 });
  assert.deepEqual(names(moved, 0), ['B']);
  assert.deepEqual(names(moved, 1), ['A', 'C']);
  assert.deepEqual(names(placeLink(SAMPLE, { ...link, name: 'A2' }, 0, 0, { group: 0, link: 0 }), 0), ['A2', 'B']);
  assert.deepEqual(names(placeLink(SAMPLE, link, 2, 0), 2), ['N'], 'an empty group');
});

test('icon search ranks exact, then prefix, then contained, and ignores spacing', () => {
  const names = ['lucide:fish', 'lucide:fish-off', 'lucide:shellfish', 'si:github', 'si:googledocs', 'lucide:book'];
  assert.deepEqual(searchIcons(names, 'fish'), ['lucide:fish', 'lucide:fish-off', 'lucide:shellfish']);
  assert.deepEqual(searchIcons(names, 'Google Docs'), ['si:googledocs']);
  assert.deepEqual(searchIcons(names, 'FISH-off'), ['lucide:fish-off']);
  assert.deepEqual(searchIcons(names, '  '), names, 'empty shows them all, in order');
  assert.deepEqual(searchIcons(names, 'si'), [], 'not the set prefix');
});

const box = (left, top, width = 10, height = 10) => ({ left, top, right: left + width, bottom: top + height });

test('a dragged tile lands by reading order in a wrapped grid', () => {
  const grid = [box(0, 0), box(20, 0), box(40, 0), box(0, 20), box(20, 20)];
  assert.equal(positionInGrid(grid, -5, -5), 0, 'above everything');
  assert.equal(positionInGrid(grid, 3, 5), 0, 'first half of the first tile');
  assert.equal(positionInGrid(grid, 8, 5), 1, 'second half of the first tile');
  assert.equal(positionInGrid(grid, 47, 5), 3, 'second half of the last tile in the first row');
  assert.equal(positionInGrid(grid, 90, 5), 3, 'off to the right of the first row');
  assert.equal(positionInGrid(grid, 5, 15), 3, 'in the gap between rows');
  assert.equal(positionInGrid(grid, 8, 25), 4);
  assert.equal(positionInGrid(grid, 90, 25), 5, 'past the end of the last row');
  assert.equal(positionInGrid(grid, 0, 90), 5, 'below everything');
  assert.equal(positionInGrid([], 5, 5), 0, 'an empty group');
});

test('a tile position ignores the gap left by the tile itself, so it cannot flip back', () => {
  // The dragged tile has moved past [0], so [0] is now where the pointer started.
  const before = [box(0, 0), box(40, 0)];
  const after = [box(20, 0), box(40, 0)];
  assert.equal(positionInGrid(before, 8, 5), 1);
  assert.equal(positionInGrid(after, 8, 5), 0, 'moves back only once past the midpoint of the tile it passed');
  assert.equal(positionInGrid(after, 28, 5), 1);
});

test('a dragged group lands by reading order down the columns', () => {
  const left = [box(0, 0, 100, 40), box(0, 50, 100, 40)];
  const right = [box(120, 10, 100, 40)];
  const groups = [...left, ...right];
  assert.equal(positionInColumns(groups, 50, 5), 0);
  assert.equal(positionInColumns(groups, 50, 30), 1);
  assert.equal(positionInColumns(groups, 50, 80), 2);
  assert.equal(positionInColumns(groups, 110, 5), 2, 'in the gap between columns');
  assert.equal(positionInColumns(groups, 150, 5), 2);
  assert.equal(positionInColumns(groups, 150, 40), 3);
  assert.equal(positionInColumns(groups, 300, 0), 3);
});

test('the nearest group is the one under the pointer, or closest to it', () => {
  const groups = [box(0, 0, 100, 40), box(120, 0, 100, 40), box(0, 60, 100, 20)];
  assert.equal(nearestRect(groups, 50, 20), 0);
  assert.equal(nearestRect(groups, 150, 20), 1);
  assert.equal(nearestRect(groups, 108, 20), 0, 'in a gap');
  assert.equal(nearestRect(groups, 50, 55), 2, 'in a gap');
  assert.equal(nearestRect(groups, 900, 20), 1, 'far outside');
  assert.equal(nearestRect([], 0, 0), -1);
});

test('the page scrolls near the screen edges, faster closer in', () => {
  assert.equal(edgeScroll(400, 800), 0);
  assert.ok(edgeScroll(60, 800) < 0);
  assert.ok(edgeScroll(740, 800) > 0);
  assert.ok(edgeScroll(5, 800) < edgeScroll(60, 800));
  assert.ok(edgeScroll(795, 800) > edgeScroll(740, 800));
  assert.equal(edgeScroll(-50, 800), edgeScroll(0, 800), 'no faster beyond the edge');
  assert.equal(edgeScroll(900, 800), edgeScroll(800, 800));
});

const BANGS = {
  w: ['Wikipedia', 'https://en.wikipedia.org/wiki/Special:Search?search={{{s}}}'],
  you: ['YouTube', 'https://www.youtube.com/results?search_query={{{s}}}'],
  nosearch: ['Plain', 'https://plain.example/page'],
};

test('bangs work in the forms DuckDuckGo accepts, and go straight to the site', () => {
  const wiki = 'https://en.wikipedia.org/wiki/Special:Search?search=';
  assert.equal(resolveBang('pasta w!', BANGS).href, `${wiki}pasta`);
  assert.equal(resolveBang('w! pasta', BANGS).href, `${wiki}pasta`);
  assert.equal(resolveBang('!w pasta', BANGS).href, `${wiki}pasta`);
  assert.equal(resolveBang('pasta !w', BANGS).href, `${wiki}pasta`);
  assert.equal(resolveBang('fresh !w pasta', BANGS).href, `${wiki}fresh%20pasta`);
  assert.equal(resolveBang('!W pasta', BANGS).href, `${wiki}pasta`, 'any case');
  assert.equal(resolveBang('a&b=c !w', BANGS).href, `${wiki}a%26b%3Dc`, 'terms are escaped');
  assert.deepEqual(resolveBang('fresh pasta w!', BANGS), { site: 'Wikipedia', query: 'fresh pasta', href: `${wiki}fresh%20pasta` });
});

test('a bang with no search terms opens the site, and one with no slot opens its page', () => {
  assert.equal(resolveBang('!w', BANGS).href, 'https://en.wikipedia.org');
  assert.equal(resolveBang('w!', BANGS).href, 'https://en.wikipedia.org');
  assert.equal(resolveBang('hi !nosearch', BANGS).href, 'https://plain.example/page');
});

test('things that are not bangs stay ordinary searches', () => {
  for (const text of ['pasta', 'pasta!', '!', '! pasta', 'w ! pasta', '!unknown pasta', 'unknown! pasta', '!constructor x', '!__proto__ x', '']) {
    assert.equal(resolveBang(text, BANGS), null, text);
  }
  assert.equal(resolveBang('you! are great today', BANGS)?.site, 'YouTube', 'first word');
  assert.equal(resolveBang('i like you! a lot', BANGS), null, 'not from the middle of a sentence');
});

test('a bang is what Enter does', () => {
  const bang = resolveBang('pasta w!', BANGS);
  const rows = buildRows('pasta w!', LINKS, SEARCH, 'Search', null, bang);
  assert.equal(rows[0].kind, 'bang');
  assert.equal(rows[0].href, bang.href);
  assert.ok(rows.every((row) => row.kind !== 'search'), 'no web search as well, which would lead to the same place');
  assert.equal(buildRows('!w', LINKS, SEARCH, 'Search', null, resolveBang('!w', BANGS))[0].label, 'Wikipedia');
});

test('the default links are valid and unique, and suggest no weather location', () => {
  assert.deepEqual(normalizePreferences(defaultPreferences), defaultPreferences);
  assert.equal(defaultPreferences.location, null);
  const urls = defaultPreferences.groups.flatMap((group) => group.links.map((link) => link.url));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every(Boolean));
});

test('tiles split into even rows, bigger first, in no more rows than wrapping would use', () => {
  assert.deepEqual(rowSizes(6, 5), [3, 3]);
  assert.deepEqual(rowSizes(7, 3), [3, 2, 2]);
  assert.deepEqual(rowSizes(10, 4), [4, 3, 3]);
  assert.deepEqual(rowSizes(9, 4), [3, 3, 3]);
  assert.deepEqual(rowSizes(5, 4), [3, 2]);
  assert.deepEqual(rowSizes(3, 4), [3]);
  assert.deepEqual(rowSizes(4, 4), [4]);
  assert.deepEqual(rowSizes(1, 3), [1]);
  assert.deepEqual(rowSizes(0, 4), []);
  assert.deepEqual(rowSizes(3, 0), [1, 1, 1], 'too narrow for even one');
  for (let tiles = 1; tiles <= 40; tiles += 1) {
    for (let fitting = 1; fitting <= 9; fitting += 1) {
      const sizes = rowSizes(tiles, fitting);
      assert.equal(sizes.reduce((sum, size) => sum + size, 0), tiles);
      assert.equal(sizes.length, Math.ceil(tiles / fitting));
      assert.ok(sizes[0] <= fitting);
      assert.ok(sizes[0] - sizes.at(-1) <= 1);
    }
  }
});
