#!/usr/bin/env node
// Refresh src/client/bangs.json: npm run update-bangs
// Names and URLs come from Kagi's MIT-licensed list. It has no popularity data, so DuckDuckGo's
// list is used only to choose which triggers to keep. Nothing else from it is stored.
// Output is { trigger: [site name, URL template] }.

import { writeFileSync } from 'node:fs';

const KAGI = 'https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json';
const RANKING = 'https://duckduckgo.com/bang.js';
const OUTPUT = new URL('../src/client/bangs.json', import.meta.url);
const KEEP = 500;

async function list(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const entries = await response.json();
  if (!Array.isArray(entries) || entries.length < 1000) throw new Error(`${url}: unexpected list; keeping the current file`);
  return entries;
}

const [bangs, ranking] = await Promise.all([list(KAGI), list(RANKING)]);

// Relative addresses and kagi.com ones only work for Kagi's own search.
const usable = bangs.filter(({ u: url }) => /^https?:\/\//i.test(url) && !/^https?:\/\/([^/]+\.)?kagi\.com\b/i.test(url));
const entries = new Map();
for (const bang of usable) entries.set(bang.t.toLowerCase(), bang);
for (const bang of usable) {
  for (const alias of bang.ts ?? []) {
    if (!entries.has(alias.toLowerCase())) entries.set(alias.toLowerCase(), bang);
  }
}

const table = {};
const ranked = [...ranking].sort((a, b) => b.r - a.r || (a.t < b.t ? -1 : 1)).map(({ t: trigger }) => trigger.toLowerCase());
for (const trigger of [...new Set(ranked)].filter((candidate) => entries.has(candidate)).slice(0, KEEP).sort()) {
  const { s: site, u: url } = entries.get(trigger);
  table[trigger] = [site, url];
}
if (Object.keys(table).length !== KEEP) throw new Error('Too few bangs; keeping the current file');
writeFileSync(OUTPUT, `${JSON.stringify(table)}\n`);
console.log(`Wrote ${KEEP} bangs`);
