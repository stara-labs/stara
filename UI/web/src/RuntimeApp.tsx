import { useEffect, useState } from 'react';
import { App } from './App';
import { loadRuntimeConfig } from './runtime-config';
import type { PublicRuntimeConfig } from './runtime-config';
import styles from './shell.module.css';

type RuntimeState =
  { status: 'loading' } | { status: 'ready'; config: PublicRuntimeConfig } | { status: 'failed' };

export function RuntimeApp() {
  const [state, setState] = useState<RuntimeState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void loadRuntimeConfig(controller.signal).then(
      (config) => {
        if (!controller.signal.aborted) setState({ status: 'ready', config });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, []);

  if (state.status === 'ready') return <App environment={state.config.environment} />;
  return (
    <main className={styles.runtimeState}>
      <h1>Stara</h1>
      {state.status === 'failed' ? (
        <p role="alert">Stara is unavailable. Reload to try again.</p>
      ) : (
        <p role="status">Loading Stara...</p>
      )}
    </main>
  );
}
