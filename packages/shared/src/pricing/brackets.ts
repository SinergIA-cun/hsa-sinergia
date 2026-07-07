import type { CapacityBracket } from '../types.js';

export function findBracket<T extends CapacityBracket>(
  rows: T[],
  invitados: number,
): T | undefined {
  return rows.find(
    (r) => invitados >= r.min && (r.max === null || invitados <= r.max),
  );
}
