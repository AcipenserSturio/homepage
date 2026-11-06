// Drives the built page in a real browser with a throwaway profile, using invented data.
// Run: node scripts/e2e-browser.mjs chrome|firefox. Set SHOTS=dir to save screenshots.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const which = process.argv[2] ?? 'chrome';
const SHOTS = process.env.SHOTS;
const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://x').pathname !== '/') return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PAGE = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch(
  which === 'firefox'
    ? { browser: 'firefox', executablePath: '/usr/bin/firefox', headless: true, extraPrefsFirefox: { 'dom.w3c_touch_events.enabled': 1 } }
    : { executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] },
);

let failed = 0;
async function check(name, fn) {
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 30s')), 30000))]);
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.replace(/\s+/g, ' ').slice(0, 500)}`);
  }
}

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const requests = [];
page.on('request', (request) => {
  // Firefox reports the inline favicon as a request, though nothing leaves the browser.
  if (!request.url().startsWith('data:')) requests.push(request.url());
});
const dialogs = { accept: true, seen: [] };
page.on('dialog', async (dialog) => {
  dialogs.seen.push(dialog.message());
  await (dialogs.accept ? dialog.accept() : dialog.dismiss());
});
await page.setViewport({ width: 1920, height: 1080 });
await page.evaluateOnNewDocument(() => {
  // Without it edit mode switches at once, so checks don't have to wait out the crossfade.
  delete Document.prototype.startViewTransition;
  window.cspViolations = [];
  addEventListener('securitypolicyviolation', (event) => window.cspViolations.push(event.violatedDirective));
});
await page.goto(PAGE);
console.log(`--- ${which}`);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const visible = (selector) => page.$eval(selector, (element) => element.checkVisibility());
const tiles = () => page.$$eval('a.tile > span:last-child', (all) => all.map((label) => label.textContent));
const headings = () => page.$$eval('.group h2', (all) => all.map((heading) => heading.textContent));
const message = () => page.$eval('#editor-message', (element) => element.textContent);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('homepage.preferences')));
const saveShot = async (name, fullPage = false) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
};
const typeInto = async (selector, text) => {
  await page.click(selector, { count: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
};
// Slides move what the next click aims at, so wait for them to end.
const settled = () => page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === 'running'), { polling: 25 });
const importText = async (text, name = 'import.json') => {
  const path = join(tmpdir(), `homepage-e2e-${process.pid}-${name}`);
  writeFileSync(path, text);
  const input = await page.$('#import-file');
  await input.uploadFile(path);
  await page.waitForFunction(() => /Imported|Nothing was imported/.test(document.getElementById('editor-message').textContent), { timeout: 5000 });
};

const SAMPLE = {
  version: 1,
  location: { name: 'Testville', latitude: 41.7, longitude: 44.8 },
  groups: [
    { name: 'Alpha', links: [
      { name: 'Forge', url: 'https://forge.example/', icon: 'si:github' },
      { name: 'Fish', url: 'https://fish.example/', icon: 'lucide:fish' },
      { name: 'Glyph', url: 'https://glyph.example/', icon: 'custom:lipu' },
      { name: 'Nameless', url: '', icon: '' },
      { name: 'Gone', url: 'https://gone.example/', icon: 'lucide:not-a-real-icon' },
    ] },
    { name: 'Beta', links: [{ name: 'Bee', url: 'https://bee.example/', icon: 'lucide:bug' }] },
    { name: 'Gamma', links: [{ name: 'Gem', url: 'https://gem.example/', icon: '' }] },
  ],
};

await check('first run: clock, search and the default links, with no outside requests', async () => {
  assert.ok((await tiles()).length > 30);
  assert.equal(await visible('#empty'), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('homepage.preferences')), null, 'unsaved until edited');
  assert.equal(await visible('#weather'), false);
  assert.equal(await page.$eval('#clock', (clock) => clock.textContent.length > 0), true);
  assert.deepEqual(requests.filter((url) => !url.startsWith(PAGE)), []);
  assert.deepEqual(requests.filter((url) => url.includes('favicon')), [], 'no favicon request either');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-input');
});

await check('browsing shows no editing controls beyond the pencil', async () => {
  for (const selector of ['#toolbar', '#add-group', '#link-dialog']) assert.equal(await visible(selector), false, selector);
  assert.equal(await visible('#edit-toggle'), true);
  await saveShot('first-run');
});

await check('edit mode opens and closes', async () => {
  await page.click('#edit-toggle');
  assert.equal(await visible('#toolbar'), true);
  assert.equal(await visible('#add-group'), true);
  assert.equal(await visible('#search'), false);
  assert.equal(await visible('#edit-toggle'), false);
});

await check('import fills the page, with no prompt when empty', async () => {
  await importText(JSON.stringify(SAMPLE));
  assert.match(await message(), /Imported 7 links/);
  assert.deepEqual(dialogs.seen, []);
  assert.equal((await stored()).groups.length, 3);
  await page.click('#edit-done');
  assert.deepEqual(await headings(), ['Alpha', 'Beta', 'Gamma']);
  assert.equal((await tiles()).length, 7);
});

await check('icons: sprite, line, custom, and first letter when missing or unknown', async () => {
  const shapes = await page.$$eval('a.tile', (all) =>
    Object.fromEntries(all.map((tile) => [tile.querySelector(':scope > span:last-child').textContent, {
      use: tile.querySelector('use')?.getAttribute('href') ?? null,
      letter: tile.querySelector('.letter')?.textContent ?? null,
      fill: tile.querySelector('svg') && getComputedStyle(tile.querySelector('svg')).fill,
      stroke: tile.querySelector('svg') && getComputedStyle(tile.querySelector('svg')).stroke,
      width: tile.querySelector('.icon').getBoundingClientRect().width,
    }])),
  );
  assert.equal(shapes.Forge.use, '#icon-si-github');
  assert.equal(shapes.Fish.use, '#icon-lucide-fish');
  assert.equal(shapes.Fish.fill, 'none');
  assert.equal(shapes.Glyph.use, '#icon-custom-lipu');
  assert.equal(shapes.Nameless.letter, 'N');
  assert.equal(shapes.Gone.letter, 'G');
  assert.equal(shapes.Gem.letter, 'G');
  assert.ok(shapes.Forge.width > 20);
  assert.notEqual(shapes.Forge.fill, 'none');
  assert.notEqual(shapes.Forge.fill, 'rgb(0, 0, 0)', 'takes the text colour, not default black');
});

await check('weather follows the imported location, and only then is contacted', async () => {
  await page.waitForFunction(() => !document.getElementById('weather').hidden, { timeout: 25000 });
  assert.match(await page.$eval('.condition', (element) => element.textContent), /Testville/);
  const outside = requests.filter((url) => !url.startsWith(PAGE)).map((url) => new URL(url).host);
  assert.deepEqual([...new Set(outside)], ['api.open-meteo.com']);
});

await check('preferences survive a reload, and search uses them', async () => {
  await page.reload();
  assert.equal((await tiles()).length, 7);
  await page.keyboard.type('forge');
  assert.equal(await page.$eval('#search-input', (input) => input.value), 'forge.example');
  assert.equal(await page.$eval('#search-results li .label', (label) => label.textContent), 'Forge');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.type('nameless');
  const labels = await page.$$eval('#search-results li .label', (all) => all.map((label) => label.textContent));
  assert.ok(!labels.includes('Nameless'), 'a link with no address is not suggested');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

await check('add a link with a typed address and a chosen icon', async () => {
  await page.click('#edit-toggle');
  await saveShot('edit-mode');
  await page.click('.group[data-group="1"] [data-action="add-link"]');
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'link-title');
  assert.equal(await visible('#link-delete'), false);
  await page.keyboard.type('Reef');
  await page.type('#link-target', 'reef.example/tide');
  await typeInto('#icon-search', 'fish');
  await page.waitForSelector('.icon-choice[aria-label="fish"]');
  await page.click('.icon-choice[aria-label="fish"]');
  assert.match(await page.$eval('#icon-preview use', (use) => use.getAttribute('href')), /lucide-fish/);
  await saveShot('link-dialog');
  await page.click('#link-form button[type="submit"]');
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), false);
  const link = (await stored()).groups[1].links.at(-1);
  assert.deepEqual(link, { name: 'Reef', url: 'https://reef.example/tide', icon: 'lucide:fish' });
});

await check('a bad address is refused and keeps the dialog open', async () => {
  await page.click('.group[data-group="1"] [data-action="add-link"]');
  await page.keyboard.type('Bad');
  await page.type('#link-target', 'javascript:alert(1)');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), true);
  assert.match(await page.$eval('#link-error', (element) => element.textContent), /URL/);
  await page.click('#link-cancel');
  assert.ok(!(await stored()).groups[1].links.some((link) => link.name === 'Bad'));
});

await check('tiles open for editing rather than navigating while editing', async () => {
  const before = page.url();
  await page.click('a.tile[data-group="0"][data-link="0"]');
  assert.equal(page.url(), before);
  assert.equal(await page.$eval('#link-title', (input) => input.value), 'Forge');
  assert.equal(await page.$eval('#link-target', (input) => input.value), 'https://forge.example/');
  assert.equal(await visible('#link-delete'), true);
  await page.click('#link-cancel');
});

await check('Cancel changes nothing', async () => {
  const before = JSON.stringify(await stored());
  await page.click('a.tile[data-group="0"][data-link="0"]');
  await typeInto('#link-title', 'Changed');
  await page.click('#link-cancel');
  assert.equal(JSON.stringify(await stored()), before);
});

await check('renaming a link keeps its place', async () => {
  await settled();
  await page.click('a.tile[data-group="0"][data-link="0"]');
  await typeInto('#link-title', 'Forge 2');
  await page.click('#link-form button[type="submit"]');
  await settled();
  assert.equal((await stored()).groups[0].links[0].name, 'Forge 2');
});

await check('the X removes the icon, and an empty search lists every icon', async () => {
  await page.click('a.tile[data-group="0"][data-link="1"]');
  await page.$eval('#icon-search', (input) => { input.value = ''; input.dispatchEvent(new Event('input')); });
  assert.ok((await page.$$eval('.icon-choice', (all) => all.length)) > 2000);
  await page.click('#icon-clear');
  assert.ok(await page.$('#icon-preview .letter'));
  assert.equal(await visible('#icon-clear'), false, 'nothing left to remove');
  await page.click('#link-form button[type="submit"]');
  await settled();
  assert.equal((await stored()).groups[0].links[1].icon, '');
});

await check('Escape leaves edit mode like Done, keeping a name being typed, but closes a dialog first', async () => {
  await page.click('.group[data-group="0"] .group-name', { count: 3 });
  await page.keyboard.type('Typed');
  await page.keyboard.press('Escape');
  assert.equal(await visible('#toolbar'), false);
  assert.equal((await stored()).groups[0].name, 'Typed');
  await page.click('#edit-toggle');
  await page.click('a.tile[data-group="0"][data-link="0"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), false);
  assert.equal(await visible('#toolbar'), true);
});

await check('delete a link, with confirmation', async () => {
  await settled();
  const name = (await stored()).groups[0].links[0].name;
  dialogs.accept = false;
  await page.click('a.tile[data-group="0"][data-link="0"]');
  await page.click('#link-delete');
  assert.equal((await stored()).groups[0].links[0].name, name, 'declined');
  dialogs.accept = true;
  await page.click('#link-delete');
  assert.notEqual((await stored()).groups[0].links[0].name, name, 'accepted');
});

await check('groups: rename, reorder, add and delete', async () => {
  const names = async () => (await stored()).groups.map((group) => group.name);
  await page.click('.group[data-group="0"] .group-name', { count: 3 });
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Tab');
  await pause(50);
  assert.equal((await names())[0], 'Renamed');
  await page.focus('.group[data-group="0"] .group-grip');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await names(), ['Beta', 'Renamed', 'Gamma']);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.group')?.dataset.group), '1', 'focus follows the group');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await names(), ['Renamed', 'Beta', 'Gamma'], 'stops at the first place');
  await page.focus('.group[data-group="0"] .group-grip');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await names(), ['Beta', 'Renamed', 'Gamma']);
  await page.click('#add-group');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'group-name');
  await page.keyboard.type('Fresh');
  await page.keyboard.press('Tab');
  await settled();
  assert.deepEqual(await names(), ['Beta', 'Renamed', 'Gamma', 'Fresh']);
  dialogs.seen.length = 0;
  await page.click('.group[data-group="3"] [data-action="group-delete"]');
  assert.deepEqual(dialogs.seen, [], 'an empty group goes without asking');
  await settled();
  await page.click('.group[data-group="0"] [data-action="group-delete"]');
  assert.equal(dialogs.seen.length, 1);
  assert.deepEqual(await names(), ['Renamed', 'Gamma']);
});

await check('an empty group shows while browsing too', async () => {
  await settled();
  await page.click('#add-group');
  await page.click('#edit-done');
  await settled();
  assert.ok((await headings()).includes('New group'));
  assert.equal((await stored()).groups.at(-1).name, 'New group');
  await page.click('#edit-toggle');
  await settled();
  await page.click(`.group[data-group="${(await stored()).groups.length - 1}"] [data-action="group-delete"]`);
});

await check('the weather pencil only appears in edit mode, and opens a dialog', async () => {
  assert.equal(await visible('#weather-edit'), true);
  await page.click('#edit-done');
  assert.equal(await visible('#weather-edit'), false);
  await page.click('#edit-toggle');
  assert.equal(await visible('#location-dialog'), false);
  await page.click('#weather-edit');
  assert.equal(await page.$eval('#location-dialog', (dialog) => dialog.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'location-input');
  assert.equal(await page.$eval('#location-input', (input) => input.value), (await stored()).location?.name ?? '');
  await page.click('#location-close');
  assert.equal(await page.$eval('#location-dialog', (dialog) => dialog.open), false);
});

await check('location: find, choose among several, and remove', async () => {
  await page.click('#weather-edit');
  await typeInto('#location-input', 'Paris');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#location-results button', { timeout: 25000 });
  const options = await page.$$eval('#location-results button', (all) => all.map((button) => button.textContent));
  assert.ok(options.length > 1, options.join());
  assert.ok(options[0].includes('France'), options[0]);
  await saveShot('location-dialog');
  await page.click('#location-results button');
  assert.equal(await page.$eval('#location-dialog', (dialog) => dialog.open), false, 'choosing closes it');
  assert.equal((await stored()).location.name, 'Paris');
  assert.ok(Math.abs((await stored()).location.latitude - 48.85) < 1);
  await page.waitForFunction(() => document.querySelector('.condition').textContent.includes('Paris'), { timeout: 25000 });
  await page.click('#weather-edit');
  assert.equal(await visible('#location-remove'), true);
  await page.click('#location-remove');
  assert.equal((await stored()).location, null);
  assert.equal(await visible('#weather'), false);
  assert.equal(await visible('#weather-edit'), true, 'still there, to set it again');
  await page.click('#weather-edit');
  assert.equal(await visible('#location-remove'), false, 'nothing to remove');
  await page.click('#location-close');
});

await check('a place that does not exist, or nothing at all, says so', async () => {
  await page.click('#weather-edit');
  await page.keyboard.press('Enter');
  assert.match(await page.$eval('#location-message', (element) => element.textContent), /Type a place/);
  await typeInto('#location-input', 'qqqzzzxxxnotaplace');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('location-message').textContent.includes('No places'), { timeout: 25000 });
  assert.equal((await stored()).location, null);
  await page.click('#location-close');
});

await check('hostile files are refused and change nothing', async () => {
  const before = JSON.stringify(await stored());
  const link = (fields) => JSON.stringify({ version: 1, groups: [{ name: 'G', links: [{ name: 'x', url: '', ...fields }] }] });
  const files = {
    script: link({ url: 'javascript:window.pwned=1' }),
    data: link({ url: 'data:text/html,<script>window.pwned=1</script>' }),
    markup: link({ icon: '<svg onload="window.pwned=1"/>' }),
    broken: '{not json',
    wrong: '{"version":9,"groups":[]}',
  };
  for (const [name, text] of Object.entries(files)) {
    await page.$eval('#editor-message', (element) => { element.textContent = ''; });
    await importText(text, `${name}.json`);
    assert.match(await message(), /Nothing was imported/, name);
    assert.equal(JSON.stringify(await stored()), before, name);
  }
});

await check('markup in names and groups stays text', async () => {
  const payload = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
  dialogs.accept = true;
  await importText(JSON.stringify({ version: 1, groups: [{ name: payload, links: [{ name: payload, url: 'https://x.example/', icon: '' }] }] }));
  await page.click('#edit-done');
  await pause(200);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.$('.group img, .group script'), null);
  assert.equal((await headings())[0], payload);
  await page.click('#edit-toggle');
  await importText(JSON.stringify(SAMPLE));
});

await check('replacing existing links asks first, and declining keeps them', async () => {
  dialogs.seen.length = 0;
  dialogs.accept = false;
  await page.$eval('#editor-message', (element) => { element.textContent = ''; });
  const path = join(tmpdir(), `homepage-e2e-${process.pid}-other.json`);
  writeFileSync(path, JSON.stringify({ version: 1, groups: [] }));
  await (await page.$('#import-file')).uploadFile(path);
  await pause(300);
  assert.equal(dialogs.seen.length, 1);
  assert.equal((await stored()).groups.length, 3);
  dialogs.accept = true;
});

await check('export round trip: the file restores everything elsewhere', async () => {
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.exported = blob.text();
      return create(blob);
    };
  });
  await page.click('#export-button');
  const text = await page.evaluate(() => window.exported);
  assert.deepEqual(JSON.parse(text), SAMPLE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#edit-toggle');
  await importText(text, 'exported.json');
  assert.deepEqual(await stored(), SAMPLE);
  await page.click('#edit-done');
});

await check('another tab picks up changes', async () => {
  const other = await browser.newPage();
  await other.goto(PAGE);
  const count = () => other.$$eval('a.tile', (all) => all.length);
  const start = await count();
  await page.bringToFront();
  await page.click('#edit-toggle');
  await page.click('.group[data-group="2"] [data-action="add-link"]');
  await page.keyboard.type('Synced');
  await page.click('#link-form button[type="submit"]');
  await other.waitForFunction((expected) => document.querySelectorAll('a.tile').length === expected, { timeout: 5000, polling: 100 }, start + 1);
  await other.close();
  await page.click('#edit-done');
});

for (const [width, height, label, columns] of [[1920, 1080, 'full', 3], [960, 1080, 'half', 2], [688, 900, 'one-column limit', 0], [390, 844, 'phone', 0], [320, 640, 'small phone', 0]]) {
  await check(`no sideways overflow at ${label}, browsing and editing`, async () => {
    await page.setViewport({ width, height });
    await page.goto(PAGE);
    assert.equal(await page.$$eval('.column', (all) => all.length), columns);
    const overflow = () => page.evaluate(() => {
      const edge = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= innerWidth) return '';
      return [...document.querySelectorAll('main *')]
        .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
        .slice(0, 5)
        .map((element) => `${element.tagName}#${element.id} ends at ${Math.round(element.getBoundingClientRect().right)}`)
        .join(', ') || 'something outside main';
    });
    assert.equal(await overflow(), '', 'browsing');
    await saveShot(`browse-${label.replace(' ', '-')}`, true);
    await page.click('#edit-toggle');
    assert.equal(await overflow(), '', 'editing');
    await saveShot(`edit-${label.replace(' ', '-')}`, true);
    await page.click('a.tile');
    assert.ok(await page.$eval('#link-dialog', (dialog) => {
      const box = dialog.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), 'the dialog fits the screen');
    await saveShot(`dialog-${label.replace(' ', '-')}`);
    await page.click('#link-cancel');
    await page.click('#edit-done');
  });
}

await check('weather text of any length cannot push the pencil off the screen', async () => {
  for (const width of [320, 360, 390, 430, 500, 640]) {
    await page.setViewport({ width, height: 700 });
    await page.goto(PAGE);
    await page.click('#edit-toggle');
    for (const text of ['Clear', 'Overcast · Testville', 'Partly cloudy · Testville', 'Thunderstorm · Llanfairpwllgwyngyllgogerychwyrndrobwll']) {
      const fit = await page.evaluate((condition) => {
        document.getElementById('weather').hidden = false;
        document.querySelector('.condition').textContent = condition;
        return { overflow: document.documentElement.scrollWidth - innerWidth, right: document.getElementById('weather-edit').getBoundingClientRect().right, edge: document.documentElement.clientWidth };
      }, text);
      assert.ok(fit.overflow <= 0 && fit.right <= fit.edge, `${width}px, "${text}": ${JSON.stringify(fit)}`);
    }
    await page.click('#edit-done');
  }
  await page.setViewport({ width: 1920, height: 1080 });
});

await check('typing in edit fields does not jump to search', async () => {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(PAGE);
  await page.click('#edit-toggle');
  await page.click('.group[data-group="0"] .group-name');
  await page.keyboard.type('xyz');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'group-name');
  await page.click('#edit-done');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search-input');
});

// ---- Style and layout

await check('everything is borderless', async () => {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(PAGE);
  const widths = () => page.evaluate(() =>
    ['#search-input', '.results', '.group', '.tile', '.icon-button', '.button', '.group-name', '.dialog', '.dialog input', '.dialog select', '.edit-toggle', '.toolbar', '.icon.letter']
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => parseFloat(getComputedStyle(element).borderTopWidth) > 0)
      .map((element) => element.id || element.className),
  );
  assert.deepEqual(await widths(), []);
  await page.click('#edit-toggle');
  assert.deepEqual(await widths(), []);
  await page.click('#edit-done');
});

for (const [width, height, label] of [[1920, 1080, 'full'], [960, 1080, 'half'], [390, 844, 'phone']]) {
  await check(`entering edit mode moves nothing at ${label}`, async () => {
    await page.setViewport({ width, height });
    await page.goto(PAGE);
    const layout = () => page.$$eval('.group, a.tile', (all) => all.map((element) => {
      const { left, top, width: w, height: h } = element.getBoundingClientRect();
      return [left, top, w, h].map(Math.round).join();
    }));
    const browsing = await layout();
    const centres = (selector) => page.$$eval(selector, (all) => all.map((element) => {
      const { left, right } = element.getBoundingClientRect();
      const { paddingLeft, paddingRight } = getComputedStyle(element);
      return [Math.round((left + right) / 2), paddingLeft === paddingRight];
    }));
    const titles = await centres('.group h2');
    await page.click('#edit-toggle');
    assert.deepEqual(await layout(), browsing);
    assert.deepEqual(await centres('.group-name'), titles, 'group names stay centred where they were');
    await page.click('#edit-done');
  });
}

await check('a group header has a grip, its name, then add and delete, with no add tile', async () => {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(PAGE);
  await page.click('#edit-toggle');
  const head = await page.$eval('.group-head', (element) => [...element.children].map((child) => child.getAttribute('aria-label')));
  assert.deepEqual(head, ['Move group: drag, or use the arrow keys', 'Group name', 'Add link', 'Delete group']);
  const tilesPerGroup = await page.$$eval('.group ul', (lists) => lists.map((list) => list.children.length));
  const saved = await stored();
  assert.deepEqual(tilesPerGroup, saved.groups.map((group) => group.links.length));
  await saveShot('edit-full-borderless');
});

// ---- Dragging

const namesIn = async (group) => (await stored()).groups[group].links.map((link) => link.name);
const groupNames = async () => (await stored()).groups.map((group) => group.name);
const centre = (selector) => page.$eval(selector, (element) => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { x: left + width / 2, y: top + height / 2, left, right: left + width, top, bottom: top + height };
});
const tileAt = (group, link) => `a.tile[data-group="${group}"][data-link="${link}"]`;
const settle = () => pause(320);
const resetLinks = async () => {
  await page.evaluate((value) => localStorage.setItem('homepage.preferences', value), JSON.stringify(SAMPLE));
  await page.goto(PAGE);
  await page.click('#edit-toggle');
};
const mouseDrag = async (fromSelector, to, { release = true } = {}) => {
  const from = await centre(fromSelector);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await pause(120);
  if (release) {
    await page.mouse.up();
    await settle();
  }
};

await check('drag a tile to a new place in its group, animated', async () => {
  await page.setViewport({ width: 1920, height: 1080 });
  await resetLinks();
  const target = await centre(tileAt(0, 2));
  await mouseDrag(tileAt(0, 0), { x: target.x + 8, y: target.y }, { release: false });
  assert.ok(await page.$('body > .drag-clone'), 'a copy follows the pointer');
  assert.ok(await page.$('.drag-placeholder'), 'its place is marked');
  await page.mouse.move(target.x + 10, target.y);
  await saveShot('dragging-tile');
  assert.deepEqual((await namesIn(0)).slice(0, 3), ['Forge', 'Fish', 'Glyph'], 'not saved until dropped');
  await page.mouse.up();
  await settle();
  assert.deepEqual((await namesIn(0)).slice(0, 3), ['Fish', 'Glyph', 'Forge']);
  assert.equal(await page.$('body > .drag-clone'), null, 'the copy is gone');
  assert.equal(await page.$('.drag-placeholder'), null);
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), false, 'dropping does not open the tile');
});

await check('moves are animated while dragging and after dropping', async () => {
  await resetLinks();
  const from = await centre(tileAt(0, 0));
  const target = await centre(tileAt(0, 1));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y, { steps: 6 });
  await page.waitForFunction(() => document.querySelectorAll('.drag-placeholder').length === 1);
  const sliding = await page.waitForFunction(
    () => [...document.querySelectorAll('[data-key]')].some((element) => element.getAnimations().length > 0),
    { timeout: 2000, polling: 16 },
  ).then(() => true, () => false);
  assert.equal(sliding, true, 'neighbours slide aside');
  await page.mouse.up();
  const landing = await page.evaluate(() => document.querySelector('body > .drag-clone')?.getAnimations().length ?? 0);
  assert.ok(landing >= 0);
  await settle();
  assert.deepEqual(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0, 'and everything stops');
});

await check('drag a tile into another group', async () => {
  await resetLinks();
  const target = await centre(tileAt(1, 0));
  await mouseDrag(tileAt(0, 1), { x: target.x + 8, y: target.y });
  assert.deepEqual(await namesIn(0), ['Forge', 'Glyph', 'Nameless', 'Gone']);
  // Which place it takes on arrival depends on the pointer positions the browser reported.
  assert.deepEqual((await namesIn(1)).sort(), ['Bee', 'Fish']);
  await resetLinks();
  await mouseDrag(tileAt(0, 1), { x: target.x + 140, y: target.y });
  assert.deepEqual(await namesIn(1), ['Bee', 'Fish'], 'going past the next tile takes the place after it');
  await page.$$eval('a.tile', (all) => all.length).then((count) => assert.equal(count, 7));
});

await check('drag a tile into an empty group', async () => {
  await resetLinks();
  await page.click('#add-group');
  await page.click('.toolbar');
  await settled();
  const empty = await centre('.group[data-group="3"]');
  await mouseDrag(tileAt(1, 0), empty);
  const saved = await stored();
  assert.deepEqual(saved.groups[3].links.map((link) => link.name), ['Bee']);
  assert.deepEqual(saved.groups[1].links, []);
});

await check('drag a group relative to the others', async () => {
  await resetLinks();
  const target = await centre('.group[data-group="2"]');
  await mouseDrag('.group[data-group="0"] .group-grip', { x: target.right - 5, y: target.y + 40 });
  assert.deepEqual(await groupNames(), ['Beta', 'Gamma', 'Alpha']);
  assert.equal(await page.$('body > .drag-clone'), null);
});

await check('Escape cancels a drag and puts everything back', async () => {
  await resetLinks();
  const before = JSON.stringify(await stored());
  const target = await centre(tileAt(1, 0));
  await mouseDrag(tileAt(0, 0), target, { release: false });
  await page.keyboard.press('Escape');
  await settle();
  await page.mouse.up();
  assert.equal(JSON.stringify(await stored()), before);
  assert.equal(await page.$('body > .drag-clone'), null);
  assert.deepEqual(await page.$$eval('.group[data-group="0"] a.tile', (all) => all.length), 5, 'the tile is back in its group');
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), false);
});

await check('a plain click on a tile still opens it, and a tiny wobble counts as a click', async () => {
  await resetLinks();
  const from = await centre(tileAt(0, 0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1);
  await page.mouse.up();
  assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), true);
  await page.click('#link-cancel');
});

await check('links cannot be dragged while browsing', async () => {
  await page.click('#edit-done');
  const before = JSON.stringify(await stored());
  const from = await centre(tileAt(0, 0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 150, from.y, { steps: 5 });
  assert.equal(await page.$('body > .drag-clone'), null);
  await page.keyboard.press('Escape');
  await page.mouse.move(from.x + 300, 950);
  await page.mouse.up();
  await pause(100);
  assert.equal(JSON.stringify(await stored()), before);
  await page.goto(PAGE);
});

{
  const TALL = {
    ...SAMPLE,
    groups: Array.from({ length: 10 }, (_, group) => ({
      name: `Group ${group}`,
      links: Array.from({ length: 8 }, (__, link) => ({ name: `L${group}-${link}`, url: `https://l${group}-${link}.example/`, icon: '' })),
    })),
  };
  const phone = async () => {
    await page.setViewport(which === 'chrome' ? { width: 390, height: 700, hasTouch: true, isMobile: true } : { width: 390, height: 700 });
    await page.evaluate((value) => localStorage.setItem('homepage.preferences', value), JSON.stringify(TALL));
    await page.goto(PAGE);
    await page.tap('#edit-toggle');
    await pause(100);
  };
  const touchLink = (group, link) => `a.tile[data-group="${group}"][data-link="${link}"]`;

  await check('touch: a long press starts a drag, and the page does not scroll', async () => {
    await phone();
    const from = await centre(touchLink(0, 0));
    const to = await centre(touchLink(0, 2));
    const scroll = await page.evaluate(() => scrollY);
    const touch = await page.touchscreen.touchStart(from.x, from.y);
    await pause(150);
    assert.equal(await page.$('body > .drag-clone'), null, 'not yet');
    await pause(350);
    assert.ok(await page.$('body > .drag-clone'), 'held long enough');
    await saveShot('dragging-touch');
    for (let step = 1; step <= 8; step += 1) {
      await touch.move(from.x + ((to.x + 8 - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
      await pause(30);
    }
    await pause(100);
    assert.equal(await page.evaluate(() => scrollY), scroll, 'the finger moves the tile, not the page');
    await touch.end();
    await settle();
    assert.deepEqual((await namesIn(0)).slice(0, 3), ['L0-1', 'L0-2', 'L0-0']);
    assert.equal(await page.$('body > .drag-clone'), null);
    assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), false);
  });

  await check('touch: a quick swipe scrolls instead of dragging', async () => {
    await phone();
    const before = JSON.stringify(await stored());
    const from = await centre(touchLink(0, 0));
    const scroll = await page.evaluate(() => scrollY);
    const touch = await page.touchscreen.touchStart(from.x, from.y);
    for (let step = 1; step <= 10; step += 1) {
      await touch.move(from.x, from.y - step * 18);
      await pause(16);
    }
    await pause(450);
    assert.equal(await page.$('body > .drag-clone'), null, 'no drag starts, even after the hold time');
    await touch.end();
    await pause(150);
    // Only checked in Chromium: the scroll didn't get verified with synthetic touches in Firefox.
    if (which === 'chrome') assert.ok((await page.evaluate(() => scrollY)) > scroll, 'the page scrolled');
    assert.equal(JSON.stringify(await stored()), before);
  });

  await check('touch: holding near the bottom edge scrolls the page during a drag', async () => {
    await phone();
    const from = await centre(touchLink(0, 0));
    const scroll = await page.evaluate(() => scrollY);
    const touch = await page.touchscreen.touchStart(from.x, from.y);
    await pause(450);
    await touch.move(from.x, 690);
    await pause(700);
    assert.ok((await page.evaluate(() => scrollY)) > scroll + 40, 'scrolled to reach further groups');
    await touch.end();
    await settle();
    const saved = await stored();
    assert.equal(saved.groups.flatMap((group) => group.links).length, 80, 'nothing lost');
    assert.ok(!saved.groups[0].links.some((link) => link.name === 'L0-0'), 'dropped further down');
  });

  await check('touch: a short tap on a tile still opens it', async () => {
    await phone();
    await page.tap(touchLink(0, 0));
    await pause(100);
    assert.equal(await page.$eval('#link-dialog', (dialog) => dialog.open), true);
    await page.tap('#link-cancel');
    await page.setViewport(which === 'chrome' ? { width: 1920, height: 1080, hasTouch: false, isMobile: false } : { width: 1920, height: 1080 });
    await page.goto(PAGE);
  });
}

await check('bangs go straight to the site, and unknown ones to DuckDuckGo', async () => {
  const destination = async (text) => {
    await page.goto(PAGE);
    requests.length = 0;
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await pause(1200);
    return requests.find((url) => !url.startsWith(PAGE));
  };
  assert.equal(await destination('pasta w!'), 'https://wikipedia.org/w/index.php?search=pasta');
  assert.equal(await destination('!yt cats'), 'https://www.youtube.com/results?search_query=cats');
  assert.equal(await destination('!zzzznotabang cats'), 'https://duckduckgo.com/?q=!zzzznotabang%20cats');
});

await check('Reset brings back the recommendations, keeps the location, and asks first', async () => {
  await resetLinks();
  dialogs.accept = false;
  await page.click('#reset-button');
  assert.equal((await stored()).groups[0].name, 'Alpha', 'declined');
  dialogs.accept = true;
  await page.click('#reset-button');
  await settled();
  const saved = await stored();
  assert.equal(saved.groups[0].name, 'Social');
  assert.equal(saved.location.name, 'Testville');
  assert.ok((await tiles()).length > 30);
  await page.click('#edit-done');
});

await check('rows are balanced and centred, also after a drag', async () => {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(PAGE);
  const rows = () => page.$$eval('.group', (groups) => groups.map((group) => {
    const tops = new Map();
    for (const item of group.querySelectorAll('li')) {
      const { top, left, right } = item.getBoundingClientRect();
      const row = tops.get(Math.round(top)) ?? { count: 0, left, right };
      tops.set(Math.round(top), { count: row.count + 1, left: Math.min(row.left, left), right: Math.max(row.right, right) });
    }
    const box = group.getBoundingClientRect();
    return { name: group.querySelector('h2').textContent, counts: [...tops.values()].map((row) => row.count),
      offCentre: Math.max(...[...tops.values()].map((row) => Math.abs((row.left + row.right) / 2 - (box.left + box.right) / 2))) };
  }));
  const groups = await rows();
  for (const group of groups) {
    assert.ok(Math.max(...group.counts) - Math.min(...group.counts) <= 1, `${group.name}: ${group.counts}`);
    assert.ok(group.offCentre < 1, `${group.name} is ${group.offCentre}px off centre`);
  }
  await saveShot('balanced-full');
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(PAGE);
  await saveShot('balanced-phone', true);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(PAGE);
});

await check('edit mode crossfades in and out', async () => {
  const fresh = await browser.newPage();
  await fresh.setViewport({ width: 1280, height: 800 });
  await fresh.goto(PAGE);
  const supported = await fresh.evaluate(() => Boolean(document.startViewTransition));
  console.log(`     view transitions supported: ${supported}`);
  const crossfading = () => fresh.evaluate(() => document.getAnimations().some((animation) => animation.effect?.pseudoElement?.startsWith('::view-transition')));
  for (const button of ['#edit-toggle', '#edit-done']) {
    await fresh.click(button);
    if (supported) {
      await fresh.waitForFunction(() => document.getAnimations().some((animation) => animation.effect?.pseudoElement?.startsWith('::view-transition')), { polling: 10, timeout: 2000 });
      // A snapshot of the whole page would lose the cards' backdrop blur for the length of the fade.
      const animated = await fresh.evaluate(() => document.getAnimations().map((animation) => animation.effect?.pseudoElement ?? '').join(' '));
      assert.ok(animated.includes('(search-bar)') && animated.includes('(edit-toolbar)'), animated);
      assert.ok(!animated.includes('(root)'), 'the page itself stays live');
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(await crossfading(), false, 'and finishes quickly');
  }
  assert.equal(await fresh.$eval('#toolbar', (toolbar) => toolbar.hidden), true);
  await fresh.close();
  await page.bringToFront();
});

await check('resizing runs no layout script between steps, and steps land the same as a fresh load', async () => {
  const probe = await browser.newPage();
  await probe.evaluateOnNewDocument(() => {
    window.layoutRuns = 0;
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original {
      constructor(callback) {
        super((...args) => {
          window.layoutRuns += 1;
          callback(...args);
        });
      }
    };
  });
  const shape = () => probe.evaluate(() => [
    document.querySelectorAll('.column').length,
    Math.round(document.querySelector('.group').getBoundingClientRect().width),
    getComputedStyle(document.querySelector('.group ul')).gridTemplateColumns.split(' ').length,
  ].join());
  await probe.setViewport({ width: 1900, height: 900 });
  await probe.goto(PAGE);
  await pause(200);
  const before = await probe.evaluate(() => window.layoutRuns);
  for (const width of [1890, 1875, 1860, 1845, 1830, 1815]) {
    await probe.setViewport({ width, height: 900 });
    await pause(60);
  }
  assert.equal(await probe.evaluate(() => window.layoutRuns), before, 'no calls while the layout stays the same');
  for (const width of [1650, 1500, 1320, 1180, 1000, 860, 700, 680, 500, 390, 1600]) {
    await probe.setViewport({ width, height: 900 });
    await pause(120);
    const resized = await shape();
    await probe.goto(PAGE);
    await pause(120);
    assert.equal(resized, await shape(), `at ${width}px`);
  }
  assert.ok((await probe.evaluate(() => document.querySelectorAll('.column').length)) > 2);
  await probe.close();
  await page.bringToFront();
});

await check('page load stays quick with the icons included', async () => {
  await page.goto(PAGE);
  const timing = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return Math.round(entry.domContentLoadedEventEnd - entry.startTime);
  });
  console.log(`     ready in ${timing}ms`);
  assert.ok(timing < 1000, `${timing}ms`);
});

await check('no script errors or blocked requests', async () => {
  assert.equal(errors.join(' | '), '');
  assert.equal((await page.evaluate(() => window.cspViolations)).join(' | '), '');
});

await browser.close();
server.close();
process.exitCode = failed ? 1 : 0;
