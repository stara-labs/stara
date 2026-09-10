import { Button, Status } from '@stara/ui';
import type { OperationalState } from '@stara/ui';
import styles from './shell.module.css';

const rows: {
  id: string;
  section: string;
  title: string;
  supporting: string;
  state: OperationalState;
  stateLabel: string;
  action: string;
  actionLabel: string;
  context: string;
}[] = [
  {
    id: 'address',
    section: 'Needs attention',
    title: 'Choose the governing address for the client form',
    supporting:
      'Decision needed from Responsible lead | Intake Agent contributing | 2 conflicting sources',
    state: 'attention',
    stateLabel: 'Needs attention',
    action: 'Review',
    actionLabel: 'Review address decision',
    context: 'intake',
  },
  {
    id: 'brief',
    section: 'In progress',
    title: 'Verify evidence for the design-partner brief',
    supporting:
      'In progress | Product Evidence Researcher comparing 3 permitted sources | Result expected today',
    state: 'running',
    stateLabel: 'In progress',
    action: 'Open',
    actionLabel: 'Open design-partner preparation',
    context: 'conversation',
  },
  {
    id: 'scope',
    section: 'Outcomes',
    title: 'Client onboarding scope accepted',
    supporting:
      'Scope accepted by Responsible lead | Recorded 18 minutes ago | External outcome not verified',
    state: 'completed',
    stateLabel: 'Scope accepted',
    action: 'View',
    actionLabel: 'View accepted scope',
    context: 'work',
  },
];

export function Home({
  selected,
  onSelect,
  onInspect,
  onOpen,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onInspect: (origin: HTMLElement) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={styles.home}>
      {rows.map((row) => (
        <section key={row.id} className={styles.homeSection} aria-labelledby={`section-${row.id}`}>
          {row.id === 'address' ? (
            <h1 id={`section-${row.id}`}>
              {row.section}
              <span className={styles.count}>1</span>
            </h1>
          ) : (
            <h2 id={`section-${row.id}`}>{row.section}</h2>
          )}
          <div className={styles.homeRow} data-selected={selected === row.id}>
            <button
              className={styles.selectRow}
              aria-label={`Select: ${row.title}`}
              aria-pressed={selected === row.id}
              onClick={() => onSelect(row.id)}
            >
              <Status state={row.state} compact>
                {row.stateLabel}
              </Status>
              <span className={styles.rowCopy}>
                <strong>{row.title}</strong>
                <span>{row.supporting}</span>
              </span>
            </button>
            <Button
              variant={row.id === 'address' ? 'secondary' : 'quiet'}
              aria-label={row.actionLabel}
              onClick={(event) => {
                onSelect(row.id);
                if (row.id === 'address') onInspect(event.currentTarget);
                else onOpen(row.context);
              }}
            >
              {row.action}
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}
