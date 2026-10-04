/**
 * Live reorder for the Edit photo strip (iOS home-screen style): while one
 * thumb is dragged, the others slide one slot to open a gap where it would
 * land. Pure, so the e2e script checks it under Node.
 */

/** The slot the dragged thumb would drop into. */
export function dragSlot(from: number, dx: number, count: number, step: number) {
  if (count <= 0 || step <= 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dx / step)));
}

/** How far thumb `index` slides to make room while `from` hovers over `to`. */
export function makeRoomOffset(index: number, from: number, to: number, step: number) {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -step;
  if (to < from && index >= to && index < from) return step;
  return 0;
}
