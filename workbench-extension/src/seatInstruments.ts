import type { LaneState, SeatId } from './domain.js';

export type SeatHealth = 'ready' | 'thin' | 'down';

export interface SeatCopy {
  name: string;
  detail: string;
}

export interface LaneCapacity {
  roles: readonly SeatId[];
  state: LaneState;
}

export interface SeatReading {
  id: SeatId;
  name: string;
  detail: string;
  health: SeatHealth;
  availableLanes: number;
  supportingLanes: number;
}

export const seatOrder: readonly SeatId[] = ['orchestrate', 'build', 'review', 'verify', 'assist'];

export const seatCopy: Readonly<Record<SeatId, SeatCopy>> = {
  orchestrate: {
    name: 'Orchestrate',
    detail: 'Direct work, preserve decisions, and judge completion.',
  },
  build: {
    name: 'Build',
    detail: 'Implement a bounded outcome and verify it.',
  },
  review: {
    name: 'Review',
    detail: 'Read-only findings, ordered by impact.',
  },
  verify: {
    name: 'Verify',
    detail: 'Re-run checks and test completion claims.',
  },
  assist: {
    name: 'Fast assist',
    detail: 'Answer or investigate without expanding scope.',
  },
};

export function healthForSeat(seat: SeatId, lanes: readonly LaneCapacity[]): SeatHealth {
  return readingForSeat(seat, lanes).health;
}

export function readingForSeat(seat: SeatId, lanes: readonly LaneCapacity[]): SeatReading {
  const copy = seatCopy[seat];
  const supporting = lanes.filter((lane) => lane.roles.includes(seat));
  const availableLanes = supporting.filter((lane) => lane.state === 'available').length;
  const checkingLanes = supporting.filter((lane) => lane.state === 'checking').length;
  let health: SeatHealth = 'ready';
  if (availableLanes === 0) {
    health = checkingLanes > 0 ? 'thin' : 'down';
  } else if (availableLanes < supporting.length) {
    health = 'thin';
  }
  return {
    id: seat,
    name: copy.name,
    detail: copy.detail,
    health,
    availableLanes,
    supportingLanes: supporting.length,
  };
}

export function instrumentsForLanes(lanes: readonly LaneCapacity[]): SeatReading[] {
  return seatOrder.map((seat) => readingForSeat(seat, lanes));
}
