import { Button, Status, TextArea } from '@stara/ui';
import { messages, sources } from './fixtures';
import type { WorkingContext } from './fixtures';
import type { ContextMemory } from './workspace';
import styles from './shell.module.css';

export function SourceComparison({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  name: string;
}) {
  return (
    <fieldset className={styles.sources}>
      <legend>Compare sources</legend>
      {sources.map((source) => (
        <label key={source.id} className={styles.source} data-selected={value === source.id}>
          <input
            type="radio"
            name={name}
            value={source.id}
            checked={value === source.id}
            onChange={() => onChange(source.id)}
          />
          <span>
            <strong>{source.title}</strong>
            <small>
              {source.freshness} | {source.provenance}
            </small>
            <span className={styles.address}>{source.address}</span>
            <small>{source.use}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ContextContent({
  context,
  memory,
  onRemember,
  onInspect,
}: {
  context: WorkingContext;
  memory: ContextMemory;
  onRemember: (patch: Partial<ContextMemory>) => void;
  onInspect: (origin: HTMLElement) => void;
}) {
  return (
    <div className={styles.contextContent}>
      <section className={styles.summary}>
        <Status state={context.status}>{context.statusLabel} (simulated)</Status>
        <p>{context.summary}</p>
        <p className={styles.muted}>Lead: {context.lead}</p>
      </section>
      {context.kind === 'Conversation' && (
        <>
          <section aria-label="Conversation" className={styles.messages}>
            {(context.draftOnly ? [] : messages).map((message, index) => (
              <article
                key={message.name}
                className={styles.message}
                data-selected={memory.selected === String(index)}
              >
                <button
                  className={styles.messageSelect}
                  aria-pressed={memory.selected === String(index)}
                  onClick={() => onRemember({ selected: String(index) })}
                  aria-label={`Select contribution from ${message.name}`}
                >
                  <strong>{message.name}</strong>
                  <span>{message.role}</span>
                </button>
                <p>{message.text}</p>
              </article>
            ))}
          </section>
          <TextArea
            label="Conversation draft"
            value={memory.draft}
            onChange={(event) => onRemember({ draft: event.target.value })}
          />
          <p className={styles.muted}>Unsent draft. No message is delivered.</p>
        </>
      )}
      {(context.kind === 'App activity' || context.kind === 'Knowledge') && (
        <>
          <section className={styles.detailSection}>
            <h2>Billing address conflict</h2>
            <p>
              The signed agreement and the account record disagree. Responsible lead owns the
              governing-source decision.
            </p>
            <p>Current form field: 200 Sample Avenue</p>
          </section>
          <SourceComparison
            name={`center-${context.id}`}
            value={memory.source}
            onChange={(source) => onRemember({ source })}
          />
          <TextArea
            label="Review notes"
            value={memory.draft}
            onChange={(event) => onRemember({ draft: event.target.value })}
          />
          <p className={styles.muted}>
            Source selection is an in-session comparison. The form and source records are unchanged.
          </p>
        </>
      )}
      {context.kind === 'Work' && (
        <>
          <section className={styles.detailSection}>
            <h2>Accepted scope</h2>
            <p>
              Responsible lead accepted the proposed onboarding scope in this fixture, 18 minutes
              ago.
            </p>
            <p>
              Prepare a plan, compare intake sources, and bring unresolved decisions to the next
              human review.
            </p>
          </section>
          <section className={styles.detailSection}>
            <h2>Next review</h2>
            <p>
              Review the governing address before preparing the client form. Product Evidence
              Researcher is comparing the permitted material.
            </p>
          </section>
          <TextArea
            label="Work notes"
            value={memory.draft}
            onChange={(event) => onRemember({ draft: event.target.value })}
          />
        </>
      )}
      {context.kind === 'Agents' && (
        <section className={styles.messages} aria-label="Collaborators">
          {messages.map((message) => (
            <article key={message.name} className={styles.message}>
              <h2>{message.name}</h2>
              <p>{message.role}</p>
              <p>{message.text}</p>
            </article>
          ))}
        </section>
      )}
      <section className={styles.detailSection} aria-label="Operational facts">
        <h2>Operational facts</h2>
        <p>External effect: None</p>
        <p>Verification: Not performed</p>
        <p>Authority: No grant to act</p>
        <p>Data: Synthetic fixture</p>
      </section>
      <Button variant="secondary" onClick={(event) => onInspect(event.currentTarget)}>
        Inspect context
      </Button>
    </div>
  );
}
