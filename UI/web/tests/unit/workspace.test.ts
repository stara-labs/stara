import { describe, expect, it } from 'vitest';
import { createWorkspace, workspaceReducer } from '../../src/workspace';
import { contexts } from '../../src/fixtures';

describe('UI-SHELL-01 durable working set', () => {
  it('Given a seeded set, when a canonical context opens twice, then its one tab is focused', () => {
    const initial = createWorkspace();
    const once = workspaceReducer(initial, { type: 'open', id: 'intake' });
    const twice = workspaceReducer(once, { type: 'open', id: 'intake' });
    expect(twice.open).toEqual(initial.open);
    expect(twice.active).toBe('intake');
  });
  it('Given Home, when close or reorder is requested, then Home stays fixed first', () => {
    const initial = createWorkspace();
    expect(workspaceReducer(initial, { type: 'close', id: 'home' })).toEqual(initial);
    expect(workspaceReducer(initial, { type: 'move', id: 'home', to: 3 })).toEqual(initial);
    expect(workspaceReducer(initial, { type: 'move', id: 'intake', to: 0 }).open[0]).toBe('home');
  });
  it('Given draft and selection, when closed and reopened, then state and operational facts survive', () => {
    let state = workspaceReducer(createWorkspace(), { type: 'open', id: 'intake' });
    state = workspaceReducer(state, {
      type: 'remember',
      id: 'intake',
      patch: {
        draft: 'Check provenance',
        source: 'record',
        selected: 'address',
        inspector: true,
        view: 'Sources',
      },
    });
    state = workspaceReducer(state, { type: 'close', id: 'intake' });
    expect(state.open).not.toContain('intake');
    state = workspaceReducer(state, { type: 'open', id: 'intake' });
    expect(state.memory.intake).toMatchObject({
      draft: 'Check provenance',
      source: 'record',
      selected: 'address',
      inspector: true,
      view: 'Sources',
    });
    expect(contexts.intake.status).toBe('attention');
    expect(contexts.intake.verified).toBe(false);
  });
  it('Given an ordered set, when reordered, then only manual order changes', () => {
    const state = workspaceReducer(createWorkspace(), { type: 'move', id: 'intake', to: 1 });
    expect(state.open).toEqual(['home', 'intake', 'work', 'conversation']);
    expect(state.active).toBe('home');
  });
  it('Given unknown close and move targets, then the working set stays unchanged', () => {
    const state = createWorkspace();
    expect(workspaceReducer(state, { type: 'close', id: 'missing' })).toBe(state);
    expect(workspaceReducer(state, { type: 'move', id: 'missing', to: 2 })).toBe(state);
    expect(workspaceReducer(state, { type: 'close', id: 'work' }).active).toBe('home');
    const opened = workspaceReducer(state, { type: 'open', id: 'knowledge' });
    expect(opened.memory.knowledge.draft).toBe('');
    expect(workspaceReducer(opened, { type: 'move', id: 'knowledge', to: 100 }).open.at(-1)).toBe(
      'knowledge',
    );
  });
});
