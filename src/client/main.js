import { drawPattern, localDate, weekHue } from './background.js';
import { resolveBang } from './bangs.js';
import bangs from './bangs.json';
import { arrangeColumns } from './columns.js';
import { defaultPreferences } from './defaults.js';
import { enableDragging } from './drag.js';
import { createEditor } from './editor.js';
import { renderGroups } from './links.js';
import { animateChanges, prefersReducedMotion } from './motion.js';
import { STORAGE_KEY, loadPreferences, savePreferences } from './preferences.js';
import { buildRows, findCompletion } from './search.js';
import { loadWeather } from './weather.js';

const SEARCH = { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' };
const byId = (id) => document.getElementById(id);

// ---- Clock, which also moves the daily look on

const clock = byId('clock');
const dateLine = byId('date');
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const pattern = byId('pattern');
let shownDate = null;

function tick() {
  const now = new Date();
  clock.textContent = timeFormat.format(now);
  clock.dateTime = now.toISOString();
  dateLine.textContent = dateFormat.format(now);
  document.documentElement.style.setProperty('--hue', weekHue(now).toFixed(1));
  if (localDate(now) !== shownDate) {
    shownDate = localDate(now);
    drawPattern(pattern, shownDate);
  }
  setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
}

tick();

// ---- Preferences and links

const form = byId('search');
const input = byId('search-input');
const nav = document.querySelector('.groups');
const weather = byId('weather');
const refreshColumns = arrangeColumns(nav);
let preferences = loadPreferences(localStorage, defaultPreferences);
let editing = false;

const searchableLinks = () => preferences.groups.flatMap((group) => group.links).filter((link) => link.url);

function draw() {
  renderGroups(nav, preferences.groups, editing);
  refreshColumns();
  byId('empty').hidden = editing || preferences.groups.length > 0;
}

function commit(next, { redraw = true } = {}) {
  const locationChanged = next.location !== preferences.location;
  preferences = next;
  const saved = savePreferences(localStorage, next);
  if (redraw) {
    if (editing) animateChanges(nav, draw);
    else draw();
  }
  if (locationChanged) loadWeather(weather, preferences.location);
  return saved;
}

// Focus the box as the address bar would, but not on touch screens, where it would
// raise the keyboard over the links.
const focusSearch = () => {
  if (!editing && !matchMedia('(pointer: coarse)').matches) input.focus();
};

function applyEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  byId('toolbar').hidden = !on;
  byId('weather-edit').hidden = !on;
  form.hidden = on;
  draw();
  focusSearch();
}

function setEditing(on) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    applyEditing(on);
    return;
  }
  // Rejects if the browser skips the animation, say in a hidden tab. The change still happens.
  document.startViewTransition(() => applyEditing(on)).ready.catch(() => {});
}

const editor = createEditor({ nav, getPreferences: () => preferences, commit, setEditing });
const dragging = enableDragging({ nav, getPreferences: () => preferences, commit, isEditing: () => editing, refreshColumns });
byId('edit-toggle').addEventListener('click', editor.open);
byId('empty-start').addEventListener('click', editor.open);

// Blurring first saves a group name still being typed, as clicking Done would.
function finishEditing() {
  document.activeElement?.blur();
  setEditing(false);
}
byId('edit-done').addEventListener('click', finishEditing);
// Escape closes an open dialog first, and a drag has already taken it for itself.
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !editing || event.defaultPrevented) return;
  event.preventDefault();
  if (editor.isBusy()) editor.closeDialog();
  else finishEditing();
});

// Another tab changed them. Leave a dialog or drag alone, as they hold positions in the old list.
addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || editor.isBusy() || dragging.isActive()) return;
  const previous = preferences.location;
  preferences = loadPreferences(localStorage, defaultPreferences);
  draw();
  if (JSON.stringify(previous) !== JSON.stringify(preferences.location)) loadWeather(weather, preferences.location);
});

draw();
document.documentElement.classList.add('drawn');
loadWeather(weather, preferences.location);
// From here on colour changes may ease in. Any sooner, and the page would visibly fade from
// the stylesheet's default hue to today's.
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));

// ---- Search

const list = byId('search-results');
let rows = [];
let active = 0;

function renderRows() {
  list.replaceChildren(
    ...rows.map((row, index) => {
      const item = document.createElement('li');
      item.id = `result-${index}`;
      item.role = 'option';
      item.className = `kind-${row.kind}`;
      item.setAttribute('aria-selected', String(index === active));
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = row.label;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = row.detail;
      item.append(label, detail);
      // pointerdown, so the row is chosen before the input's blur closes the list.
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        location.assign(row.href);
      });
      return item;
    }),
  );
  const open = rows.length > 0;
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (open) input.setAttribute('aria-activedescendant', `result-${active}`);
  else input.removeAttribute('aria-activedescendant');
}

function update(text, completion) {
  rows = buildRows(text, searchableLinks(), SEARCH.url, SEARCH.name, completion, resolveBang(text, bangs));
  active = 0;
  renderRows();
}

input.addEventListener('input', (event) => {
  const typed = input.value;
  // Complete only while adding text: deleting has to be able to remove the completion,
  // and an input method needs its composition left alone.
  const adding = event.inputType?.startsWith('insert') && !event.isComposing;
  const completion = adding && input.selectionEnd === typed.length ? findCompletion(typed, searchableLinks()) : null;
  if (completion) {
    input.value = typed + completion.address.slice(typed.length);
    input.setSelectionRange(typed.length, input.value.length);
  }
  update(typed, completion);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!rows.length) return;
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    renderRows();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    // First Escape drops the suggestions and completion, the second empties the box.
    if (rows.length) {
      input.value = input.value.slice(0, input.selectionStart);
      rows = [];
      renderRows();
    } else {
      input.value = '';
    }
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const href = rows[active]?.href ?? buildRows(input.value, searchableLinks(), SEARCH.url, SEARCH.name)[0]?.href;
  if (href) location.assign(href);
});

input.addEventListener('blur', () => {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
});
input.addEventListener('focus', () => {
  if (rows.length) renderRows();
});

focusSearch();
addEventListener('pageshow', focusSearch);

// If focus has gone elsewhere, typing still goes to the box.
addEventListener('keydown', (event) => {
  if (editing || event.target === input || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  if (event.target.closest?.('button, summary') && event.key === ' ') return;
  if (event.key === '/') event.preventDefault();
  input.focus();
});
