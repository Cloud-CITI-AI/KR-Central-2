/** The wall clock behind an interface, so durations and "now" are injected (TD-4) and tests can set them. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
