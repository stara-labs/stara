import type { Root } from 'react-dom/client';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mounted = vi.hoisted(() => ({ roots: [] as Root[] }));
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      mounted.roots.push(root);
      return root;
    },
  };
});

const notice =
  'Internal staging. Synthetic data only. Drafts are temporary and may be lost on reload or when this page closes.';
beforeEach(() => {
  vi.resetModules();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
});
afterEach(async () => {
  await act(async () => {
    for (const root of mounted.roots.splice(0)) root.unmount();
  });
  document.getElementById('root')?.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    await import('../../src/main');
  });
}
function reply(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
function expectNotice() {
  const notes = screen.getAllByRole('note', { name: 'Staging environment' });
  expect(notes).toHaveLength(1);
  expect(notes[0]).toHaveTextContent(notice);
  expect(notes[0]).toBeVisible();
  expect(notes[0]).not.toHaveAttribute('aria-live');
  expect(within(notes[0]).queryByRole('button')).not.toBeInTheDocument();
  return notes[0];
}

describe('REL-09 actual browser entry runtime gate', () => {
  it('does not expose a shell while configuration is pending, then renders staging', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetcher = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetcher);
    await mount();
    expect(screen.queryByRole('tab', { name: 'Home' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/runtime-config',
      expect.objectContaining({ cache: 'no-store' }),
    );
    await act(async () => {
      resolve(reply({ schemaVersion: 1, environment: 'staging' }));
    });
    await screen.findByRole('tab', { name: 'Home' });
    expectNotice();
  });

  it('preserves one exact non-dismissible notice through contexts, inspection, theme, and native dialogs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ schemaVersion: 1, environment: 'staging' })),
    );
    const user = userEvent.setup();
    await mount();
    await screen.findByRole('tab', { name: 'Home' });
    expectNotice();
    await user.click(screen.getByRole('button', { name: 'Review address decision' }));
    expectNotice();
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expectNotice();
    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    expectNotice();
    await user.click(screen.getByRole('button', { name: 'Working contexts' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('note', { name: 'Staging environment' }),
    ).toBe(expectNotice());
    // jsdom does not synthesize a native dialog cancel event from Escape.
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'New' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('note', { name: 'Staging environment' }),
    ).toBe(expectNotice());
    await user.click(screen.getByRole('button', { name: 'Close New conversation' }));
    expectNotice();
  });

  it('omits staging notice only after validated development config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ schemaVersion: 1, environment: 'development' })),
    );
    await mount();
    await screen.findByRole('tab', { name: 'Home' });
    expect(screen.queryByRole('note', { name: 'Staging environment' })).not.toBeInTheDocument();
  });

  it.each([
    ['missing', async () => reply({})],
    ['invalid', async () => reply({ schemaVersion: 1, environment: 'production' })],
    [
      'unrecognized fields',
      async () =>
        reply({
          schemaVersion: 1,
          environment: 'staging',
          secret: 'synthetic-runtime-private-canary',
        }),
    ],
    ['HTTP failure', async () => new Response('synthetic-runtime-private-canary', { status: 503 })],
    [
      'network failure',
      async () => {
        throw new Error('synthetic-runtime-private-canary');
      },
    ],
  ])(
    'shows an explicit sanitized failure and no shell for %s configuration',
    async (_name, response) => {
      vi.stubGlobal('fetch', vi.fn(response));
      await mount();
      expect(await screen.findByRole('alert')).toBeVisible();
      expect(screen.getByRole('alert').textContent?.trim().length).toBeGreaterThan(0);
      expect(screen.queryByRole('tab', { name: 'Home' })).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent('synthetic-runtime-private-canary');
    },
  );
});
