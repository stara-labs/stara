import { useState } from 'react';
import { Dialog, Icon, IconButton, Status } from '@stara/ui';
import type { WorkingContext } from './fixtures';
import { StagingNotice } from './StagingNotice';
import type { PublicRuntimeConfig } from './runtime-config';
import styles from './shell.module.css';

export function ContextPicker({
  contexts,
  open,
  filter = '',
  environment = 'development',
  onOpen,
  onDismiss,
  onMove,
}: {
  contexts: Record<string, WorkingContext>;
  open: string[];
  filter?: string;
  environment?: PublicRuntimeConfig['environment'];
  onOpen: (id: string) => void;
  onDismiss: () => void;
  onMove: (id: string, to: number) => void;
}) {
  const [query, setQuery] = useState(filter);
  const ordered = [...open, ...Object.keys(contexts).filter((id) => !open.includes(id))].filter(
    (id) => id !== 'home',
  );
  const matches = ordered.filter((id) =>
    `${contexts[id].title} ${contexts[id].kind}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog title="Working contexts" onDismiss={onDismiss}>
      {environment === 'staging' && <StagingNotice />}
      <label className={styles.searchLabel}>
        Find a context
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.contextList}>
        {matches.map((id) => (
          <div key={id} className={styles.contextOption}>
            <button
              onClick={() => {
                onOpen(id);
                onDismiss();
              }}
              aria-label={`Open ${contexts[id].title}`}
            >
              <Icon name={contexts[id].icon} />
              <span>
                <strong>{contexts[id].title}</strong>
                <small>
                  {contexts[id].kind} | {open.includes(id) ? 'Open' : 'Closed'} |{' '}
                  <Status state={contexts[id].status}>{contexts[id].statusLabel}</Status>
                </small>
              </span>
            </button>
            {id !== 'home' && open.includes(id) && (
              <div className={styles.reorderTools}>
                <IconButton
                  icon="up"
                  label={`Move ${contexts[id].title} earlier`}
                  disabled={open.indexOf(id) === 1}
                  onClick={() => onMove(id, open.indexOf(id) - 1)}
                />
                <IconButton
                  icon="down"
                  label={`Move ${contexts[id].title} later`}
                  disabled={open.indexOf(id) === open.length - 1}
                  onClick={() => onMove(id, open.indexOf(id) + 1)}
                />
              </div>
            )}
          </div>
        ))}
        {matches.length === 0 && <p>No matching contexts.</p>}
      </div>
    </Dialog>
  );
}
