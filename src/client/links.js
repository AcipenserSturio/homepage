// Draw the link groups. Editing adds its controls here, and client/editor.js handles them.

import { iconFor, spriteIcon } from './icons.js';

function iconButton(label, icon, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  if (action) button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(spriteIcon(icon));
  return button;
}

function tile(link, groupIndex, linkIndex, key, editing) {
  const item = document.createElement('li');
  item.dataset.key = key;
  const anchor = document.createElement('a');
  anchor.className = 'tile';
  // Addresses were checked to be http or https when they were stored or imported.
  anchor.href = link.url || '#';
  anchor.dataset.group = groupIndex;
  anchor.dataset.link = linkIndex;
  if (editing) anchor.draggable = false;
  const label = document.createElement('span');
  label.textContent = link.name;
  anchor.append(iconFor(link), label);
  item.append(anchor);
  return item;
}

function groupHeading(group, editing) {
  if (!editing) {
    const heading = document.createElement('h2');
    heading.textContent = group.name;
    return heading;
  }
  const head = document.createElement('div');
  head.className = 'group-head';
  const grip = iconButton('Move group: drag, or use the arrow keys', 'lucide:grip-vertical');
  grip.classList.add('group-grip');
  const name = document.createElement('input');
  name.className = 'group-name';
  name.value = group.name;
  name.maxLength = 200;
  name.setAttribute('aria-label', 'Group name');
  name.autocomplete = 'off';
  name.dataset.lpignore = 'true';
  head.append(grip, name, iconButton('Add link', 'lucide:plus', 'add-link'), iconButton('Delete group', 'lucide:x', 'group-delete'));
  return head;
}

export function renderGroups(nav, groups, editing) {
  // Keys follow an element between redraws, so its move can be animated. Names and addresses
  // don't have to be unique, so count repeats.
  const seen = new Map();
  const keyFor = (text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return `${text}#${count}`;
  };
  const sections = groups.map((group, index) => {
    const section = document.createElement('section');
    section.className = 'group';
    section.dataset.group = index;
    section.dataset.key = keyFor(`group:${group.name}`);
    const list = document.createElement('ul');
    list.append(...group.links.map((link, linkIndex) => tile(link, index, linkIndex, keyFor(`link:${link.url}|${link.name}`), editing)));
    const heading = groupHeading(group, editing);
    // The same name in both modes makes edit mode's crossfade pair them up.
    heading.style.viewTransitionName = `group-heading-${index}`;
    section.append(heading, list);
    return section;
  });
  nav.replaceChildren(...sections);
}
