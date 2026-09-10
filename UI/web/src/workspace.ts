export type LocalView = 'Context' | 'Sources' | 'Activity';
export interface ContextMemory {
  draft: string;
  source: string;
  selected: string;
  inspector: boolean;
  view: LocalView;
}
export interface Workspace {
  open: string[];
  active: string;
  memory: Record<string, ContextMemory>;
  announcement: string;
}
export type WorkspaceAction =
  | { type: 'open'; id: string }
  | { type: 'close'; id: string }
  | { type: 'move'; id: string; to: number }
  | { type: 'remember'; id: string; patch: Partial<ContextMemory> };

export const freshMemory = (): ContextMemory => ({
  draft: '',
  source: 'agreement',
  selected: '',
  inspector: false,
  view: 'Context',
});

export function createWorkspace(): Workspace {
  const open = ['home', 'work', 'conversation', 'intake', 'research'];
  return {
    open,
    active: 'home',
    memory: Object.fromEntries(open.map((id) => [id, freshMemory()])),
    announcement: '',
  };
}

export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'open') {
    return {
      ...state,
      active: action.id,
      open: state.open.includes(action.id) ? state.open : [...state.open, action.id],
      memory: { ...state.memory, [action.id]: state.memory[action.id] ?? freshMemory() },
    };
  }
  if (action.type === 'remember') {
    return {
      ...state,
      memory: { ...state.memory, [action.id]: { ...state.memory[action.id], ...action.patch } },
    };
  }
  const index = state.open.indexOf(action.id);
  if (action.id === 'home' || index < 0) return state;
  if (action.type === 'close') {
    const open = state.open.filter((id) => id !== action.id);
    return {
      ...state,
      open,
      active: state.active === action.id ? open[Math.max(0, index - 1)] : state.active,
      announcement: 'Tab removed from working set. Underlying work is unchanged.',
    };
  }
  const open = state.open.filter((id) => id !== action.id);
  const to = Math.max(1, Math.min(action.to, open.length));
  open.splice(to, 0, action.id);
  return { ...state, open, announcement: `Tab moved to position ${to + 1} of ${open.length}.` };
}
