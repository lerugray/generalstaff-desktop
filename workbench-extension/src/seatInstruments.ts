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

function isInstalled(state: LaneCapacity['state']): boolean {
  return state !== 'missing';
}

export function readingForSeat(seat: SeatId, lanes: readonly LaneCapacity[]): SeatReading {
  const copy = seatCopy[seat];
  const supporting = lanes.filter((lane) => lane.roles.includes(seat) && isInstalled(lane.state));
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

export function orchestratorWelcome(health: SeatHealth): { title: string; detail: string } {
  if (health === 'down') {
    return {
      title: 'The orchestrator seat needs a model lane.',
      detail: 'Catch up, make rulings, follow up, or dispatch work once a lane for this seat is ready. Every message continues this same session from the private GeneralStaff root.',
    };
  }
  if (health === 'thin') {
    return {
      title: 'The orchestrator seat is ready.',
      detail: 'Some backing lanes are thin. Catch up, make rulings, follow up, or dispatch work. Every message continues this same session from the private GeneralStaff root.',
    };
  }
  return {
    title: 'The orchestrator seat is ready.',
    detail: 'Catch up, make rulings, follow up, or dispatch work. Every message continues this same session from the private GeneralStaff root.',
  };
}

export function instrumentsForLanes(lanes: readonly LaneCapacity[]): SeatReading[] {
  return seatOrder.map((seat) => readingForSeat(seat, lanes));
}
