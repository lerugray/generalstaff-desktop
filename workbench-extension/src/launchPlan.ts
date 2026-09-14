/**
 * Activation-seam helpers for M3d. Launch opens only the Command Deck;
 * Lanes and Desk are never auto-opened. Toggle state is idempotent.
 */

export type AuxPanel = 'lanes' | 'desk';

export interface LaunchPlan {
  openCommandDeck: boolean;
  openLanes: boolean;
  openDesk: boolean;
  /** Immersive mode may still close the bottom panel; it must not close the aux bar. */
  closeAuxiliaryBar: boolean;
  closePanel: boolean;
}

export function planOpenOnLaunch(options: {
  openOnLaunch: boolean;
  immersiveMode: boolean;
}): LaunchPlan {
  if (!options.openOnLaunch) {
    return {
      openCommandDeck: false,
      openLanes: false,
      openDesk: false,
      closeAuxiliaryBar: false,
      closePanel: false,
    };
  }
  return {
    openCommandDeck: true,
    openLanes: false,
    openDesk: false,
    closeAuxiliaryBar: false,
    closePanel: options.immersiveMode,
  };
}

/**
 * Pure toggle: first call focuses the panel (show aux); second call for the
 * same panel hides aux; switching panel while open focuses the other.
 */
export function nextAuxToggleState(
  current: AuxPanel | null,
  target: AuxPanel,
): { next: AuxPanel | null; action: 'show' | 'hide' } {
  if (current === target) return { next: null, action: 'hide' };
  return { next: target, action: 'show' };
}

/** Whether a topbar Lanes/Desk toggle should read as pressed. */
export function auxTogglePressed(auxFocus: AuxPanel | null, panel: AuxPanel): boolean {
  return auxFocus === panel;
}

/**
 * Drop stale aux focus when the operator hid the bar by another path
 * (so the next toggle chord shows instead of no-op hiding).
 */
export function reconcileAuxFocus(
  current: AuxPanel | null,
  visibility: { lanes: boolean; desk: boolean },
): AuxPanel | null {
  if (current === 'lanes' && !visibility.lanes) return null;
  if (current === 'desk' && !visibility.desk) return null;
  return current;
}
