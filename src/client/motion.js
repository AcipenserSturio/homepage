// Animate layout changes: note where each [data-key] element is, make the change, then
// slide everything from its old place to its new one.

const DURATION_MS = 180;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

let settled = new Map();

const keyed = (root) => root.querySelectorAll('[data-key]');

function measure(root) {
  const rects = new Map();
  for (const element of keyed(root)) {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    rects.set(element.dataset.key, {
      left: left + scrollX,
      right: right + scrollX,
      top: top + scrollY,
      bottom: bottom + scrollY,
      width,
      height,
    });
  }
  return rects;
}

/**
 * Where an element is ending up, in page coordinates, ignoring any slide in progress.
 * Dragging aims at these, as aiming at moving elements makes them swap back and forth.
 */
export const settledRect = (key) => settled.get(key);

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animateChanges(root, change) {
  // Measured mid-slide, so an interrupted slide carries on from where it visibly is.
  const before = measure(root);
  for (const element of keyed(root)) {
    for (const animation of element.getAnimations()) animation.cancel();
  }
  change();
  settled = measure(root);
  if (prefersReducedMotion()) return;
  for (const element of keyed(root)) {
    const from = before.get(element.dataset.key);
    const to = settled.get(element.dataset.key);
    if (!from) continue;
    let x = from.left - to.left;
    let y = from.top - to.top;
    // A tile also moves with its group, so take off what the group's slide already covers.
    const group = element.matches('.group') ? null : element.closest('.group');
    const groupFrom = group && before.get(group.dataset.key);
    const groupTo = group && settled.get(group.dataset.key);
    if (groupFrom && groupTo) {
      x -= groupFrom.left - groupTo.left;
      y -= groupFrom.top - groupTo.top;
    }
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
    element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: DURATION_MS, easing: EASING });
  }
}
