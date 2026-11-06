// Stack the link groups into columns. CSS multi-column can't centre its columns against
// each other, so these are real elements, which the stylesheet centres with flexbox.

// Keep in step with the one-column media query in styles.css.
const ONE_COLUMN = '(max-width: 43rem)';
const MIN_TILES_ACROSS = 3;
// Rough sizes in rem, only used to compare groups. Long names that wrap are ignored.
const HEADER_REM = 3.2;
const ROW_REM = 4.4;
const GROUP_GAP_REM = 0.75;

let tilesAcross = 1;

/** A group's rough height, from how many rows its tiles take up. */
export function estimatedHeight(tiles, across) {
  return HEADER_REM + rowSizes(tiles, across).length * ROW_REM;
}

/**
 * How many columns fit, and how wide to make them. Columns hold a whole number of tiles
 * with no slack, and no more than the largest group needs, so spare width goes to the
 * page's margins rather than to empty space inside the cards.
 */
export function columnLayout({ available, tile, tileGap, pad, gap, groups, mostTiles }) {
  const widthFor = (tiles) => tiles * tile + (tiles - 1) * tileGap + 2 * pad;
  const fitting = Math.floor((available + gap) / (widthFor(MIN_TILES_ACROSS) + gap));
  const count = Math.min(Math.max(fitting, 2), groups);
  const share = (available - gap * Math.max(count - 1, 0)) / Math.max(count, 1);
  const room = Math.floor((share - 2 * pad + tileGap) / (tile + tileGap));
  const tilesAcross = Math.max(Math.min(room, Math.max(mostTiles, MIN_TILES_ACROSS)), 1);
  return { count, tilesAcross, width: widthFor(tilesAcross) };
}

/**
 * Split identical tiles into rows as evenly as possible, bigger rows first: 6 tiles with
 * room for 5 is 3 + 3, not 5 + 1. It uses the fewest rows that fit, the same as plain
 * wrapping would, so a group is no taller for being balanced.
 */
export function rowSizes(tiles, fitting) {
  if (tiles <= 0) return [];
  const rows = Math.ceil(tiles / Math.max(fitting, 1));
  const size = Math.floor(tiles / rows);
  const bigger = tiles % rows;
  return Array.from({ length: rows }, (_, row) => (row < bigger ? size + 1 : size));
}

/**
 * Lay out one group's tiles in balanced rows. The grid's columns are half a tile wide and
 * each tile spans two, so a row one tile shorter is centred by starting one column in.
 */
export function balanceRows(list) {
  const items = [...list.children];
  const sizes = rowSizes(items.length, tilesAcross);
  list.style.setProperty('--half-columns', 2 * (sizes[0] ?? 1));
  for (const item of items) item.style.gridColumnStart = '';
  let first = 0;
  for (const size of sizes) {
    if (size < sizes[0]) items[first].style.gridColumnStart = '2';
    first += size;
  }
}

/**
 * Split groups into columns, keeping their order, so the tallest column is as short as
 * possible. Returns one list of group indexes per column.
 */
export function partition(heights, count, gap = 0) {
  const total = heights.length;
  const span = (start, end) => {
    let height = gap * (end - start - 1);
    for (let index = start; index < end; index += 1) height += heights[index];
    return height;
  };
  // best[columns][used]: the shortest possible tallest column for the first `used` groups.
  const best = Array.from({ length: count + 1 }, () => new Array(total + 1).fill(Infinity));
  const cut = Array.from({ length: count + 1 }, () => new Array(total + 1).fill(0));
  best[0][0] = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    for (let used = columns; used <= total; used += 1) {
      for (let start = columns - 1; start < used; start += 1) {
        const tallest = Math.max(best[columns - 1][start], span(start, used));
        if (tallest < best[columns][used]) {
          best[columns][used] = tallest;
          cut[columns][used] = start;
        }
      }
    }
  }
  const result = [];
  let end = total;
  for (let columns = count; columns >= 1; columns -= 1) {
    const start = cut[columns][end];
    result.unshift(Array.from({ length: end - start }, (_, offset) => start + offset));
    end = start;
  }
  return result;
}

/**
 * Lay the groups out now and whenever the layout has to change. Between those widths a
 * resize runs no script: .layout-probe in styles.css snaps its size to the steps where the
 * column count or tiles per row would change, and only a change of size calls arrange.
 */
export function arrangeColumns(nav) {
  const box = nav.parentElement;
  let shown = null;

  function arrange() {
    const groups = [...nav.querySelectorAll('.group')];
    const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
    const root = getComputedStyle(document.documentElement);
    const rem = parseFloat(root.fontSize);
    const length = (name) => parseFloat(root.getPropertyValue(name)) * rem;
    const available = box.getBoundingClientRect().width;
    const tile = length('--tile');
    const tileGap = length('--tile-gap');
    const pad = length('--pad');
    const layout = matchMedia(ONE_COLUMN).matches
      ? { count: 1, tilesAcross: Math.floor((available - 2 * pad + tileGap) / (tile + tileGap)), width: 0 }
      : columnLayout({
          available,
          tile,
          tileGap,
          pad,
          gap,
          groups: groups.length,
          mostTiles: Math.max(0, ...groups.map((group) => group.querySelector('ul').children.length)),
        });
    const key = `${layout.count}/${layout.tilesAcross}`;
    if (key === shown) return;
    shown = key;
    tilesAcross = layout.tilesAcross;
    box.style.setProperty('--columns', Math.max(layout.count, 1));
    nav.style.setProperty('--column-width', `${layout.width}px`);
    fillColumns(groups, layout.count);
  }

  function fillColumns(groups, count) {
    for (const group of groups) balanceRows(group.querySelector('ul'));
    if (count <= 1) {
      nav.replaceChildren(...groups);
      return;
    }
    const heights = groups.map((group) => estimatedHeight(group.querySelector('ul').children.length, tilesAcross));
    const columns = partition(heights, count, GROUP_GAP_REM).map((indexes) => {
      const column = document.createElement('div');
      column.className = 'column';
      column.append(...indexes.map((index) => groups[index]));
      return column;
    });
    nav.replaceChildren(...columns);
  }

  new ResizeObserver(arrange).observe(box.querySelector('.layout-probe > div'));
  matchMedia(ONE_COLUMN).addEventListener('change', arrange);
  return () => {
    shown = null;
    arrange();
  };
}
