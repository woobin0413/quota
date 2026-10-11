/**
 * First instant of the given date's calendar month, in UTC. Used to meter
 * quote usage per calendar month (everyone resets on the 1st).
 */
export function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
