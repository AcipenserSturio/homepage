// Everything personal to the page: links and weather location. It lives only in this
// browser and in files you export, never in the build. Nothing here touches the DOM.

import { toUrl } from './search.js';

export const STORAGE_KEY = 'homepage.preferences';
export const MAX_FILE_BYTES = 2_000_000;
const VERSION = 1;
const MAX_TEXT = 200;
const MAX_URL = 2000;
const ICON_NAME = /^(si|lucide|custom):[a-z0-9-]+$/;

export const emptyPreferences = () => ({ version: VERSION, location: null, groups: [] });

function isWebUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Turn what someone typed into a stored address: '' if empty, null if it isn't a web address. */
export function webAddress(text) {
  const value = text.trim();
  if (!value) return '';
  const url = toUrl(value);
  return url && isWebUrl(url) && url.length <= MAX_URL ? url : null;
}

function checkText(value, description) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new Error(`${description} must be text of up to ${MAX_TEXT} characters.`);
  }
  return value;
}

function normalizeLink(link, groupName) {
  if (typeof link !== 'object' || link === null) throw new Error(`"${groupName}" contains something that isn't a link.`);
  const name = checkText(link.name, `A link's name in "${groupName}"`);
  const url = link.url ?? '';
  // Links get clicked, so this is what stops a file from smuggling in javascript: addresses.
  if (typeof url !== 'string' || url.length > MAX_URL || (url && !isWebUrl(url))) {
    throw new Error(`"${name}" in "${groupName}" doesn't have an http or https address.`);
  }
  const icon = link.icon ?? '';
  if (typeof icon !== 'string' || (icon && !ICON_NAME.test(icon))) throw new Error(`"${name}" has an invalid icon name.`);
  return { name, url, icon };
}

function normalizeLocation(location) {
  if (location === null || location === undefined) return null;
  const { name, latitude, longitude } = location;
  const inRange = (value, limit) => typeof value === 'number' && Math.abs(value) <= limit;
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) throw new Error("The weather location's coordinates aren't valid.");
  return { name: checkText(name, 'The weather location'), latitude, longitude };
}

/** Check untrusted data and keep only the fields the page uses. Throws with a readable message. */
export function normalizePreferences(raw) {
  if (typeof raw !== 'object' || raw === null || raw.version !== VERSION || !Array.isArray(raw.groups)) {
    throw new Error("This isn't a home page preferences file.");
  }
  return {
    version: VERSION,
    location: normalizeLocation(raw.location),
    groups: raw.groups.map((group) => {
      const name = checkText(group?.name, "A group's name");
      if (!Array.isArray(group.links)) throw new Error(`"${name}" has no list of links.`);
      return { name, links: group.links.map((link) => normalizeLink(link, name)) };
    }),
  };
}

export function parsePreferences(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  return normalizePreferences(raw);
}

export const serializePreferences = (preferences) => `${JSON.stringify(preferences, null, 2)}\n`;

export function loadPreferences(storage, fallback = emptyPreferences()) {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return saved ? parsePreferences(saved) : fallback;
  } catch {
    return fallback;
  }
}

export const hasSavedPreferences = (storage) => storage.getItem(STORAGE_KEY) !== null;

export function savePreferences(storage, preferences) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export const countLinks = (preferences) => preferences.groups.reduce((sum, group) => sum + group.links.length, 0);

// ---- Edits. Each returns new preferences and leaves the old ones untouched.

export const setLocation = (preferences, location) => ({ ...preferences, location });

export function addGroup(preferences, name) {
  return { ...preferences, groups: [...preferences.groups, { name, links: [] }] };
}

export function renameGroup(preferences, index, name) {
  return { ...preferences, groups: preferences.groups.map((group, at) => (at === index ? { ...group, name } : group)) };
}

export function removeGroup(preferences, index) {
  return { ...preferences, groups: preferences.groups.filter((_, at) => at !== index) };
}

export function moveGroupTo(preferences, index, target) {
  if (target < 0 || target >= preferences.groups.length) return preferences;
  const groups = [...preferences.groups];
  groups.splice(target, 0, ...groups.splice(index, 1));
  return { ...preferences, groups };
}

export function removeLink(preferences, groupIndex, linkIndex) {
  return {
    ...preferences,
    groups: preferences.groups.map((group, at) =>
      at === groupIndex ? { ...group, links: group.links.filter((_, position) => position !== linkIndex) } : group,
    ),
  };
}

/** Add a link, or move and change one if `from` says where it was. The position counts after removal. */
export function placeLink(preferences, link, groupIndex, linkIndex, from = null) {
  const base = from ? removeLink(preferences, from.group, from.link) : preferences;
  return {
    ...base,
    groups: base.groups.map((group, at) => {
      if (at !== groupIndex) return group;
      const links = [...group.links];
      links.splice(linkIndex, 0, link);
      return { ...group, links };
    }),
  };
}
