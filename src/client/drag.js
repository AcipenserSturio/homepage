// Drag links within and between groups, and groups relative to each other. Uses pointer
// events, as native HTML drag and drop doesn't work on touch screens.
//
// With a mouse, a drag starts once the pointer moves. On touch, moving a finger has to keep
// scrolling the page, so a drag starts only after holding still.

import { balanceRows } from './columns.js';
import { animateChanges, prefersReducedMotion, settledRect } from './motion.js';
import { moveGroupTo, placeLink } from './preferences.js';

const HOLD_MS = 350;
const MOUSE_START_PX = 5;
const TOUCH_SLOP_PX = 10;
const SCROLL_EDGE_PX = 72;
const MAX_SCROLL_PX = 14;
const LANDING_MS = 160;
// Moving a group can rebalance the columns under the pointer. Waiting for further movement
// stops that from making it jump straight back.
const GROUP_REORDER_PX = 24;
// Rebalancing rows can move tiles under the pointer too, though much less.
const TILE_REORDER_PX = 8;

/** How many tiles in a wrapped grid come before a point, reading across and then down. */
export function positionInGrid(rects, x, y) {
  return rects.filter((rect) => y > rect.bottom || (y >= rect.top && x > (rect.left + rect.right) / 2)).length;
}

/** How many groups come before a point, reading down each column and then across. */
export function positionInColumns(rects, x, y) {
  return rects.filter((rect) => x > rect.right || (x >= rect.left && y > (rect.top + rect.bottom) / 2)).length;
}

/** The index of the rectangle nearest a point, so a drop in a gap still lands somewhere. */
export function nearestRect(rects, x, y) {
  let nearest = -1;
  let shortest = Infinity;
  rects.forEach((rect, index) => {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < shortest) {
      shortest = distance;
      nearest = index;
    }
  });
  return nearest;
}

/** How far to scroll this frame, when the pointer is near the top or bottom of the screen. */
export function edgeScroll(y, viewportHeight) {
  const strength = (distance) => Math.ceil((MAX_SCROLL_PX * (SCROLL_EDGE_PX - distance)) / SCROLL_EDGE_PX);
  if (y < SCROLL_EDGE_PX) return -strength(Math.max(y, 0));
  if (y > viewportHeight - SCROLL_EDGE_PX) return strength(Math.max(viewportHeight - y, 0));
  return 0;
}

const rectsOf = (elements) => elements.map((element) => settledRect(element.dataset.key)).filter(Boolean);

export function enableDragging({ nav, getPreferences, commit, isEditing, refreshColumns }) {
  let pending = null;
  let drag = null;
  let swallowClick = false;

  function moveTile() {
    const { item, pageX, pageY } = pointer();
    if (Math.hypot(drag.x - drag.reorderX, drag.y - drag.reorderY) < TILE_REORDER_PX) return;
    const sections = [...nav.querySelectorAll('.group')];
    const section = sections[nearestRect(rectsOf(sections), pageX, pageY)];
    if (!section) return;
    const list = section.querySelector('ul');
    const others = [...list.children].filter((other) => other !== item);
    const position = positionInGrid(rectsOf(others), pageX, pageY);
    const current = item.parentElement === list ? [...list.children].indexOf(item) : -1;
    if (current === position) return;
    animateChanges(nav, () => {
      const previous = item.parentElement;
      list.insertBefore(item, others[position] ?? null);
      balanceRows(previous);
      balanceRows(list);
    });
    drag.reorderX = drag.x;
    drag.reorderY = drag.y;
  }

  function moveGroup() {
    const { item, pageX, pageY } = pointer();
    if (Math.hypot(drag.x - drag.reorderX, drag.y - drag.reorderY) < GROUP_REORDER_PX) return;
    const sections = [...nav.querySelectorAll('.group')];
    const others = sections.filter((other) => other !== item);
    const position = positionInColumns(rectsOf(others), pageX, pageY);
    if (sections.indexOf(item) === position) return;
    animateChanges(nav, () => {
      if (position < others.length) others[position].before(item);
      else others.at(-1).after(item);
      refreshColumns();
    });
    drag.reorderX = drag.x;
    drag.reorderY = drag.y;
  }

  const pointer = () => ({ item: drag.item, pageX: drag.x + scrollX, pageY: drag.y + scrollY });

  function frame() {
    if (!drag) return;
    const scroll = edgeScroll(drag.y, innerHeight);
    if (scroll) scrollBy(0, scroll);
    drag.clone.style.transform = `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px) scale(1.03)`;
    if (drag.kind === 'group') moveGroup();
    else moveTile();
    drag.frame = requestAnimationFrame(frame);
  }

  function begin() {
    const { item, kind, from, x, y } = pending;
    clearTimeout(pending.timer);
    pending = null;
    animateChanges(nav, () => {});
    const rect = item.getBoundingClientRect();
    const clone = item.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.removeAttribute('data-key');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.transform = `translate(${rect.left}px, ${rect.top}px) scale(1.03)`;
    document.body.append(clone);
    document.body.classList.add('dragging');
    item.classList.add('drag-placeholder');
    swallowClick = true;
    navigator.vibrate?.(10);
    drag = { item, kind, from, clone, x, y, grabX: x - rect.left, grabY: y - rect.top, reorderX: x, reorderY: y };
    frame();
  }

  function newOrder() {
    const preferences = getPreferences();
    const { item, kind, from } = drag;
    if (kind === 'group') return moveGroupTo(preferences, from, [...nav.querySelectorAll('.group')].indexOf(item));
    const link = preferences.groups[from.group].links[from.link];
    return placeLink(preferences, link, Number(item.closest('.group').dataset.group), [...item.parentElement.children].indexOf(item), from);
  }

  /** Save the new order, or redraw the old one to cancel, and settle the clone into place. */
  function finish(next) {
    const { clone, item } = drag;
    const key = item.dataset.key;
    cancelAnimationFrame(drag.frame);
    drag = null;
    document.body.classList.remove('dragging');
    commit(next);
    setTimeout(() => {
      swallowClick = false;
    }, 80);
    const landed = [...nav.querySelectorAll('[data-key]')].find((element) => element.dataset.key === key);
    const target = settledRect(key);
    if (!landed || !target || prefersReducedMotion()) {
      clone.remove();
      return;
    }
    landed.classList.add('drag-placeholder');
    const animation = clone.animate(
      [{ transform: clone.style.transform }, { transform: `translate(${target.left - scrollX}px, ${target.top - scrollY}px)` }],
      { duration: LANDING_MS, easing: 'ease-out', fill: 'forwards' },
    );
    const done = () => {
      clone.remove();
      landed.classList.remove('drag-placeholder');
    };
    animation.onfinish = done;
    animation.oncancel = done;
  }

  function clearPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  nav.addEventListener('pointerdown', (event) => {
    if (!isEditing() || drag || event.button !== 0) return;
    const grip = event.target.closest('.group-grip');
    const tile = event.target.closest('a.tile');
    if (!grip && !tile) return;
    const section = event.target.closest('.group');
    pending = {
      id: event.pointerId,
      mouse: event.pointerType === 'mouse',
      x: event.clientX,
      y: event.clientY,
      item: grip ? section : tile.parentElement,
      kind: grip ? 'group' : 'tile',
      from: grip ? Number(section.dataset.group) : { group: Number(tile.dataset.group), link: Number(tile.dataset.link) },
    };
    if (!pending.mouse) pending.timer = setTimeout(begin, HOLD_MS);
  });

  addEventListener('pointermove', (event) => {
    if (pending?.id === event.pointerId) {
      const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (pending.mouse && moved > MOUSE_START_PX) begin();
      // A finger that moves before the hold is up is scrolling, not dragging.
      else if (!pending.mouse && moved > TOUCH_SLOP_PX) clearPending();
    }
    if (drag) {
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
  });

  addEventListener('pointerup', () => {
    clearPending();
    if (drag) finish(newOrder());
  });

  addEventListener('pointercancel', () => {
    clearPending();
    if (drag) finish(getPreferences());
  });

  // Once dragging, the finger must not scroll. A touch's pointer events can stop when its
  // element moves in the page, but its touch events carry on, so follow those too.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!drag) return;
      event.preventDefault();
      drag.x = event.touches[0].clientX;
      drag.y = event.touches[0].clientY;
    },
    { passive: false },
  );
  document.addEventListener('touchend', () => {
    if (drag) finish(newOrder());
  });

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        finish(getPreferences());
      }
    },
    true,
  );

  // The drop itself would otherwise count as selecting the tile.
  addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // Stop the browser's own link dragging and long-press menu from getting in first.
  nav.addEventListener('dragstart', (event) => {
    if (isEditing()) event.preventDefault();
  });
  nav.addEventListener('contextmenu', (event) => {
    if (isEditing() && event.target.closest('a.tile, .group-grip')) event.preventDefault();
  });

  return { isActive: () => Boolean(drag) };
}
