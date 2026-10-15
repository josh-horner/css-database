/**
 * Confirmation numbers (docs/domain-model.md#booking-was-contract): the one shared number, written on the
 * customer's labels. Lowest free number >= 100 in the season; cancelled numbers are reused on purpose.
 * Numbers still on the shelf from an earlier season (abroad/semester storage) are also treated as taken.
 */
export const FIRST_CONFIRMATION_NUMBER = 100;

export function nextConfirmationNumber(
  takenThisSeason: Iterable<number>,
  stillInStorageFromEarlierSeasons: Iterable<number> = [],
): number {
  const taken = new Set<number>([...takenThisSeason, ...stillInStorageFromEarlierSeasons]);
  let n = FIRST_CONFIRMATION_NUMBER;
  while (taken.has(n)) n++;
  return n;
}
