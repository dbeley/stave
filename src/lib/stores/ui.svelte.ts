/**
 * Ephemeral UI state: which overlay is open, what the action menu points at.
 * Nothing here is persisted — it is all reconstructible.
 */

export type OverlayKind = 'help' | 'queue' | 'login' | 'actions' | 'palette';

export type ActionTargetKind = 'album' | 'artist' | 'track';

export interface ActionTarget {
  kind: ActionTargetKind;
  id: string;
  title: string;
  /** Payloads so the menu can act without re-fetching. */
  album?: import('$lib/domain/types').Album;
  artist?: import('$lib/domain/types').Artist;
  track?: import('$lib/domain/types').Track;
}

export interface UiState {
  overlay: OverlayKind | null;
  /** What the album/track action menu (`o` / long-press) refers to. */
  actionTarget: ActionTarget | null;
  /** Cover-art / detail side pane on wide screens. */
  sidebarVisible: boolean;
  /** Set while the command line (`:`) is capturing input. */
  commandMode: boolean;
}

export class UiStore {
  readonly state: UiState;

  constructor(initial?: Partial<UiState>) {
    this.state = $state<UiState>({
      overlay: null,
      actionTarget: null,
      sidebarVisible: true,
      commandMode: false,
      ...initial,
    });
  }

  get anyOverlayOpen(): boolean {
    return this.state.overlay !== null;
  }

  openOverlay(kind: OverlayKind): void {
    this.state.overlay = kind;
  }

  closeOverlay(): void {
    this.state.overlay = null;
    this.state.commandMode = false;
  }

  toggleOverlay(kind: OverlayKind): void {
    this.state.overlay = this.state.overlay === kind ? null : kind;
  }

  isOpen(kind: OverlayKind): boolean {
    return this.state.overlay === kind;
  }

  openActions(target: ActionTarget): void {
    this.state.actionTarget = target;
    this.state.overlay = 'actions';
  }

  closeActions(): void {
    this.state.actionTarget = null;
    if (this.state.overlay === 'actions') this.state.overlay = null;
  }

  toggleSidebar(): void {
    this.state.sidebarVisible = !this.state.sidebarVisible;
  }

  reset(): void {
    this.state.overlay = null;
    this.state.actionTarget = null;
    this.state.commandMode = false;
  }
}
