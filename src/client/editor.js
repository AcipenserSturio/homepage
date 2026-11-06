// Edit mode: the toolbar, the controls on each group, and the dialogs for a link and the location.

import { defaultPreferences } from './defaults.js';
import { availableIcons, iconFor, searchIcons, spriteIcon } from './icons.js';
import {
  MAX_FILE_BYTES,
  addGroup,
  countLinks,
  hasSavedPreferences,
  moveGroupTo,
  parsePreferences,
  placeLink,
  removeGroup,
  removeLink,
  renameGroup,
  serializePreferences,
  setLocation,
  webAddress,
} from './preferences.js';
import { describePlace, findPlaces } from './weather.js';

const MESSAGE_MS = 6000;
const byId = (id) => document.getElementById(id);

export function createEditor({ nav, getPreferences, commit, setEditing }) {
  const message = byId('editor-message');
  let messageTimer = 0;
  const say = (text) => {
    message.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message.textContent = '';
    }, MESSAGE_MS);
  };
  const save = (next, options) => {
    if (!commit(next, options)) say("Couldn't save: this browser's storage is full or turned off.");
  };

  // ---- The dialog for the weather location

  const locationDialog = byId('location-dialog');
  const locationInput = byId('location-input');
  const locationMessage = byId('location-message');
  const placeList = byId('location-results');

  function choosePlace(place) {
    save(setLocation(getPreferences(), { name: place.name, latitude: place.latitude, longitude: place.longitude }));
    locationDialog.close();
    say(`Weather location set to ${describePlace(place)}.`);
  }

  byId('weather-edit').addEventListener('click', () => {
    const { location } = getPreferences();
    locationInput.value = location?.name ?? '';
    locationMessage.textContent = '';
    placeList.replaceChildren();
    byId('location-remove').hidden = !location;
    locationDialog.showModal();
    locationInput.focus();
    locationInput.select();
  });

  byId('location-close').addEventListener('click', () => locationDialog.close());

  byId('location-remove').addEventListener('click', () => {
    save(setLocation(getPreferences(), null));
    locationDialog.close();
    say('Weather location removed.');
  });

  byId('location-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    placeList.replaceChildren();
    const query = locationInput.value.trim();
    if (!query) {
      locationMessage.textContent = 'Type a place to search for.';
      return;
    }
    locationMessage.textContent = 'Searching…';
    try {
      const places = await findPlaces(query);
      if (!places.length) locationMessage.textContent = `No places found for "${query}".`;
      else if (places.length === 1) choosePlace(places[0]);
      else {
        locationMessage.textContent = 'Choose a place:';
        placeList.replaceChildren(
          ...places.map((place) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button';
            button.textContent = describePlace(place);
            button.addEventListener('click', () => choosePlace(place));
            item.append(button);
            return item;
          }),
        );
      }
    } catch {
      locationMessage.textContent = "Couldn't reach the place search. Check your connection and try again.";
    }
  });

  // ---- Import and export

  const importFile = byId('import-file');
  byId('import-button').addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const [file] = importFile.files;
    importFile.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file is too large to be preferences.');
      const imported = parsePreferences(await file.text());
      // The defaults aren't worth a warning: nothing of yours would be lost.
      if (hasSavedPreferences(localStorage) && countLinks(getPreferences()) && !confirm('Replace all your current links and location with this file?')) return;
      save(imported);
      say(`Imported ${countLinks(imported)} links.`);
    } catch (error) {
      say(`Nothing was imported. ${error.message}`);
    }
  });

  byId('export-button').addEventListener('click', () => {
    const blob = new Blob([serializePreferences(getPreferences())], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'home-preferences.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 10_000);
    say('Exported. Import the file on your other device.');
  });

  // The location stays: it's your own setting rather than one of the recommendations.
  byId('reset-button').addEventListener('click', () => {
    if (!confirm('Replace all your groups and links with the recommended ones? Export first if you might want them back.')) return;
    save(setLocation(defaultPreferences, getPreferences().location));
    say('Links reset to the recommendations.');
  });

  // ---- The dialog for one link

  const dialog = byId('link-dialog');
  const form = byId('link-form');
  const nameInput = byId('link-title');
  const addressInput = byId('link-target');
  const iconPreview = byId('icon-preview');
  const iconSearch = byId('icon-search');
  const iconGrid = byId('icon-grid');
  const deleteButton = byId('link-delete');
  const linkError = byId('link-error');
  let from = null;
  let targetGroup = 0;
  let chosenIcon = '';

  function showIcon() {
    iconPreview.replaceChildren(iconFor({ name: nameInput.value || '?', icon: chosenIcon }));
    byId('icon-clear').hidden = !chosenIcon;
  }

  function markChosenIcon() {
    for (const button of iconGrid.children) button.setAttribute('aria-pressed', String(button.dataset.name === chosenIcon));
  }

  function showIconResults() {
    const names = searchIcons(availableIcons(), iconSearch.value);
    iconGrid.replaceChildren(
      ...names.map((name) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-choice';
        button.dataset.name = name;
        button.title = name.slice(name.indexOf(':') + 1);
        button.setAttribute('aria-label', button.title);
        button.append(spriteIcon(name));
        return button;
      }),
    );
    markChosenIcon();
  }

  function chooseIcon(name) {
    chosenIcon = name;
    showIcon();
    markChosenIcon();
  }

  // This updates the buttons rather than redrawing them, which would lose the scroll position.
  iconGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.icon-choice');
    if (button) chooseIcon(button.dataset.name);
  });
  byId('icon-clear').addEventListener('click', () => chooseIcon(''));

  function openLink(groupIndex, linkIndex = null) {
    const preferences = getPreferences();
    const link = linkIndex === null ? null : preferences.groups[groupIndex].links[linkIndex];
    from = link ? { group: groupIndex, link: linkIndex } : null;
    chosenIcon = link?.icon ?? '';
    nameInput.value = link?.name ?? '';
    addressInput.value = link?.url ?? '';
    linkError.textContent = '';
    targetGroup = groupIndex;
    deleteButton.hidden = !link;
    byId('link-dialog-title').textContent = link ? 'Edit link' : 'Add link';
    iconSearch.value = link?.name ?? '';
    showIcon();
    showIconResults();
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  }

  nameInput.addEventListener('input', showIcon);
  iconSearch.addEventListener('input', showIconResults);
  // Enter in the icon search shouldn't save the whole form.
  iconSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  byId('link-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = webAddress(addressInput.value);
    if (url === null) {
      linkError.textContent = "That doesn't look like a URL. Try the full URL, starting with https://.";
      addressInput.focus();
      return;
    }
    const link = { name: nameInput.value.trim(), url, icon: chosenIcon };
    const position = from ? from.link : getPreferences().groups[targetGroup].links.length;
    save(placeLink(getPreferences(), link, targetGroup, position, from));
    dialog.close();
  });

  deleteButton.addEventListener('click', () => {
    if (!confirm(`Delete "${nameInput.value}"?`)) return;
    save(removeLink(getPreferences(), from.group, from.link));
    dialog.close();
  });

  // ---- Groups

  nav.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action], a.tile');
    if (!control || !document.body.classList.contains('editing')) return;
    event.preventDefault();
    const section = control.closest('.group');
    const index = Number(section.dataset.group);
    const preferences = getPreferences();
    switch (control.dataset.action) {
      case 'add-link':
        openLink(index);
        break;
      case 'group-delete': {
        const { name, links } = preferences.groups[index];
        if (!links.length || confirm(`Delete "${name}" and its ${links.length} links?`)) save(removeGroup(preferences, index));
        break;
      }
      default:
        openLink(index, Number(control.dataset.link));
    }
  });

  // The keyboard's way of moving a group.
  nav.addEventListener('keydown', (event) => {
    if (!event.target.matches('.group-grip')) return;
    const offset = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const index = Number(event.target.closest('.group').dataset.group);
    const target = index + offset;
    const next = moveGroupTo(getPreferences(), index, target);
    if (next === getPreferences()) return;
    save(next);
    nav.querySelector(`.group[data-group="${target}"] .group-grip`)?.focus();
  });

  // Renaming doesn't redraw, so the cursor stays where you're typing or tabbing.
  nav.addEventListener('change', (event) => {
    if (!event.target.matches('.group-name')) return;
    const index = Number(event.target.closest('.group').dataset.group);
    event.target.value = event.target.value.trim() || 'Untitled';
    save(renameGroup(getPreferences(), index, event.target.value), { redraw: false });
  });

  byId('add-group').addEventListener('click', () => {
    const next = addGroup(getPreferences(), 'New group');
    save(next);
    const input = nav.querySelector(`.group[data-group="${next.groups.length - 1}"] .group-name`);
    input?.focus();
    input?.select();
  });

  // ---- Entering and leaving

  return {
    open() {
      message.textContent = '';
      setEditing(true);
    },
    isBusy: () => dialog.open || locationDialog.open,
    closeDialog() {
      if (dialog.open) dialog.close();
      if (locationDialog.open) locationDialog.close();
    },
  };
}
