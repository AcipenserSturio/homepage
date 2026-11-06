// DuckDuckGo-style bangs, followed straight to the site without going through DuckDuckGo.
// "!w pasta" works with the bang anywhere. "pasta w!" works for the first or last word only,
// so that a sentence with an exclamation mark in it is less likely to fire one.
// Only the most popular are in the page. DuckDuckGo handles the rest when they're searched for.

const PLACEHOLDER = '{{{s}}}';

const words = (text) => text.trim().split(/\s+/).filter(Boolean);

/** Each word that could be a bang, as [its position, its trigger], best candidates first. */
function candidates(tokens) {
  const found = [];
  tokens.forEach((token, index) => {
    if (token.length > 1 && token.startsWith('!')) found.push([index, token.slice(1)]);
  });
  for (const index of new Set([0, tokens.length - 1])) {
    const token = tokens[index];
    if (token?.length > 1 && token.endsWith('!') && !token.startsWith('!')) found.push([index, token.slice(0, -1)]);
  }
  return found;
}

/** Where a bang in this text leads, or null if it has none. With no search terms, that's the site itself. */
export function resolveBang(text, bangs) {
  const tokens = words(text);
  for (const [position, trigger] of candidates(tokens)) {
    const key = trigger.toLowerCase();
    if (!Object.hasOwn(bangs, key)) continue;
    const [site, template] = bangs[key];
    const query = tokens.filter((_, index) => index !== position).join(' ');
    const href = query || !template.includes(PLACEHOLDER)
      ? template.replaceAll(PLACEHOLDER, encodeURIComponent(query))
      : new URL(template.replaceAll(PLACEHOLDER, '')).origin;
    return { site, query, href };
  }
  return null;
}
