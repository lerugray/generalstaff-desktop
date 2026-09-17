export const headroomBands = ['comfortable', 'tight', 'stop soon'] as const;

export type HeadroomBand = (typeof headroomBands)[number];

export type HeadroomSignalId = 'session' | 'pool' | 'occupancy';

export interface HeadroomSignals {
  transcriptCharacters: number;
  attachedFiles: number;
  skillCharacters: number;
  availableLanes: number;
  installedLanes: number;
  totalLanes: number;
  availableHelpers: number;
  totalHelpers: number;
  activeTasks: number;
  reviewTasks: number;
  attentionCount: number;
  deskRuns: number;
  projectCount: number;
}

export interface HeadroomSignalReading {
  id: HeadroomSignalId;
  name: string;
  band: HeadroomBand;
  reading: string;
  detail: string;
  pressure: number;
}

export interface HeadroomReading {
  band: HeadroomBand;
  glance: string;
  fill: number;
  signals: HeadroomSignalReading[];
}

const bandGlance: Readonly<Record<HeadroomBand, string>> = {
  comfortable: 'Room to keep going',
  tight: 'Headroom is getting short',
  'stop soon': 'Stop soon',
};

const signalNames: Readonly<Record<HeadroomSignalId, string>> = {
  session: 'Session',
  pool: 'Lane pool',
  occupancy: 'Fleet',
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function rise(value: number, tightAt: number, stopAt: number): number {
  const amount = Math.max(0, Number.isFinite(value) ? value : 0);
  if (tightAt <= 0 || stopAt <= 0) return amount > 0 ? 1 : 0;
  if (stopAt <= tightAt) return amount >= stopAt ? 1 : amount > 0 ? 0.4 : 0;
  if (amount >= stopAt) {
    return clampUnit(0.75 + 0.25 * ((amount - stopAt) / Math.max(stopAt * 0.5, 1)));
  }
  if (amount >= tightAt) {
    return 0.4 + 0.35 * ((amount - tightAt) / (stopAt - tightAt));
  }
  return 0.4 * (amount / tightAt);
}

export function bandFromPressure(pressure: number): HeadroomBand {
  if (pressure >= 0.75) return 'stop soon';
  if (pressure >= 0.4) return 'tight';
  return 'comfortable';
}

export function sessionPressure(signals: HeadroomSignals): number {
  const promptChars = Math.max(0, signals.transcriptCharacters) + Math.max(0, signals.skillCharacters);
  return Math.max(rise(promptChars, 24_000, 80_000), rise(signals.attachedFiles, 4, 9));
}

export function poolPressure(signals: HeadroomSignals): number {
  const installed = Math.max(0, signals.installedLanes);
  if (installed <= 0) return 0;
  if (signals.availableLanes <= 0) return 1;
  if (signals.availableLanes >= installed) {
    if (signals.totalHelpers > 0 && signals.availableHelpers <= 0) return 0.45;
    return 0;
  }
  const down = installed - signals.availableLanes;
  return rise(down, 1, Math.max(2, installed - 1));
}

export function occupancyPressure(signals: HeadroomSignals): number {
  const projects = Math.max(0, signals.projectCount);
  const fleetTight = Math.max(2, projects * 2);
  const fleetStop = Math.max(fleetTight + 1, projects * 5);
  return Math.max(
    rise(signals.reviewTasks, 3, 9),
    rise(signals.attentionCount, 2, 6),
    signals.deskRuns > 0 ? 0.55 : 0,
    rise(signals.activeTasks, fleetTight, fleetStop),
  );
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sessionCopy(signals: HeadroomSignals, band: HeadroomBand): { reading: string; detail: string } {
  const files = Math.max(0, signals.attachedFiles);
  const fileLine = files === 0 ? 'no files pinned' : countLabel(files, 'file pinned', 'files pinned');
  if (band === 'stop soon') {
    return { reading: 'This session is heavy. Wrap up soon.', detail: fileLine };
  }
  if (band === 'tight') {
    return { reading: 'This session is getting long.', detail: fileLine };
  }
  return { reading: 'This session is still light.', detail: fileLine };
}

function poolCopy(signals: HeadroomSignals, band: HeadroomBand): { reading: string; detail: string } {
  const lanes = `${Math.max(0, signals.availableLanes)} of ${Math.max(0, signals.totalLanes)} lanes ready`;
  const helpers = `${Math.max(0, signals.availableHelpers)} of ${Math.max(0, signals.totalHelpers)} private tools`;
  if (signals.availableLanes <= 0) {
    return { reading: 'No model lane is ready.', detail: `${lanes}. ${helpers}.` };
  }
  if (band === 'stop soon') {
    return { reading: 'Almost no lanes are ready.', detail: `${lanes}. ${helpers}.` };
  }
  if (band === 'tight') {
    return { reading: 'Some lanes are down.', detail: `${lanes}. ${helpers}.` };
  }
  return { reading: 'The installed lanes are ready.', detail: `${lanes}. ${helpers}.` };
}

function occupancyCopy(signals: HeadroomSignals, band: HeadroomBand): { reading: string; detail: string } {
  const active = countLabel(Math.max(0, signals.activeTasks), 'active', 'active');
  const review = countLabel(Math.max(0, signals.reviewTasks), 'for review', 'for review');
  const detail = `${active}. ${review}.`;
  if (band === 'stop soon') {
    return { reading: 'The fleet is crowded. Finish what is open.', detail };
  }
  if (band === 'tight') {
    return { reading: 'The fleet is busy.', detail };
  }
  return { reading: 'The fleet has room.', detail };
}

function signalReading(
  id: HeadroomSignalId,
  pressure: number,
  copy: (band: HeadroomBand) => { reading: string; detail: string },
): HeadroomSignalReading {
  const band = bandFromPressure(pressure);
  const text = copy(band);
  return {
    id,
    name: signalNames[id],
    band,
    reading: text.reading,
    detail: text.detail,
    pressure: clampUnit(pressure),
  };
}

export function isIdleDesk(signals: HeadroomSignals): boolean {
  return Math.max(0, signals.transcriptCharacters) <= 0
    && Math.max(0, signals.attachedFiles) <= 0
    && Math.max(0, signals.skillCharacters) <= 0
    && Math.max(0, signals.deskRuns) <= 0;
}

export function readHeadroom(signals: HeadroomSignals): HeadroomReading {
  const session = signalReading('session', sessionPressure(signals), (band) => sessionCopy(signals, band));
  const pool = signalReading('pool', poolPressure(signals), (band) => poolCopy(signals, band));
  const occupancy = signalReading('occupancy', occupancyPressure(signals), (band) => occupancyCopy(signals, band));
  const signalsRead = [session, pool, occupancy];
  const idle = isIdleDesk(signals);
  const pressure = idle ? 0 : Math.max(session.pressure, pool.pressure, occupancy.pressure);
  const band = idle ? 'comfortable' : bandFromPressure(pressure);
  return {
    band,
    glance: bandGlance[band],
    fill: idle ? 0.22 : clampUnit(0.16 + pressure * 0.78),
    signals: signalsRead,
  };
}

export function emptyHeadroomSignals(): HeadroomSignals {
  return {
    transcriptCharacters: 0,
    attachedFiles: 0,
    skillCharacters: 0,
    availableLanes: 0,
    installedLanes: 0,
    totalLanes: 0,
    availableHelpers: 0,
    totalHelpers: 0,
    activeTasks: 0,
    reviewTasks: 0,
    attentionCount: 0,
    deskRuns: 0,
    projectCount: 0,
  };
}
