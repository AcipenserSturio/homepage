// Address-bar behaviour, without touching the DOM: decide what typed text means,
// complete it from the page's own links, and build the suggestion list.

// Things that look like domains but are more likely a search for a file or tool.
const FILE_LIKE_ENDINGS = new Set(['js', 'ts', 'py', 'rs', 'md', 'sh', 'txt', 'exe', 'pdf', 'html', 'css', 'json']);
const WEB_SCHEME = /^(https?|ftp):\/\//i;
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]\S*)?$/i;
const DOMAIN = /^(?:[a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)(:\d+)?([/?#]\S*)?$/i;

const MIN_COMPLETION_LENGTH = 2;
const MAX_LINK_ROWS = 6;

/** The URL this text should open, or null if it should be searched for instead. */
export function toUrl(text) {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  if (WEB_SCHEME.test(value)) return URL.canParse(value) ? value : null;
  if (LOCAL_HOST.test(value)) return `http://${value}`;
  const domain = value.match(DOMAIN);
  if (domain && !FILE_LIKE_ENDINGS.has(domain[1].toLowerCase())) return `https://${value}`;
  return null;
}

/** A link's address as it would be typed: no scheme, "www." or trailing slash. */
export function displayAddress(url) {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function rank(query, link) {
  const name = link.name.toLowerCase();
  const address = displayAddress(link.url).toLowerCase();
  if (name.startsWith(query)) return 0;
  if (address.startsWith(query)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (name.includes(query) || address.includes(query)) return 3;
  return null;
}

/** Links matching the text, best first, keeping the page's order between equals. */
export function matchLinks(text, links) {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  return links
    .map((link) => ({ link, score: rank(query, link) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.link);
}

/** The first link whose address starts with the text, as the address bar would autofill. */
export function findCompletion(text, links) {
  const query = text.toLowerCase();
  if (query.length < MIN_COMPLETION_LENGTH || /\s/.test(query)) return null;
  const link = links.find((candidate) => displayAddress(candidate.url).toLowerCase().startsWith(query));
  return link ? { link, address: displayAddress(link.url) } : null;
}

/**
 * Rows for the dropdown. The first row is what Enter does. A bang wins, then a completion,
 * then anything that looks like a URL, then a web search.
 */
export function buildRows(text, links, searchUrl, searchName, completion = null, bang = null) {
  const value = text.trim();
  if (!value) return [];
  const search = {
    kind: 'search',
    label: value,
    detail: `Search ${searchName}`,
    href: searchUrl + encodeURIComponent(value),
  };
  const url = toUrl(value);
  const go = url && { kind: 'url', label: value, detail: 'Go to address', href: url };
  const asRow = (link) => ({ kind: 'link', label: link.name, detail: displayAddress(link.url), href: link.url });

  const matches = matchLinks(value, links).filter((link) => link !== completion?.link);
  const others = matches.slice(0, MAX_LINK_ROWS).map(asRow);
  // A web search as well would only lead to the same place, as DuckDuckGo follows bangs too.
  if (bang) return [{ kind: 'bang', label: bang.query || bang.site, detail: `Search ${bang.site}`, href: bang.href }, ...others];
  if (completion) return [asRow(completion.link), ...others, go || search];
  return go ? [go, ...others, search] : [search, ...others];
}
