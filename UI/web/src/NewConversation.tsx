import { useEffect, useRef, useState } from 'react';
import { Button } from '@stara/ui';
import { conversationParticipants, participantById } from './conversation-fixtures';
import styles from './shell.module.css';

export function NewConversation({
  onCancel,
  onStart,
}: {
  onCancel: () => void;
  onStart: (message: string, participantIds: string[]) => void;
}) {
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [pickerMode, setPickerMode] = useState<'inline' | 'full' | null>(null);
  const [query, setQuery] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const participantInput = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const returnPickerFocus = useRef(false);
  const valid = message.trim().length > 0;

  useEffect(() => participantInput.current?.focus(), []);
  useEffect(() => {
    if (pickerMode === 'full') document.getElementById('participant-search')?.focus();
    else if (returnPickerFocus.current) {
      add.current?.focus();
      returnPickerFocus.current = false;
    }
  }, [pickerMode]);
  useEffect(() => {
    if (!pickerMode) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !picker.current?.contains(event.target as Node) &&
        event.target !== add.current &&
        event.target !== participantInput.current
      )
        setPickerMode(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [pickerMode]);

  const matches = conversationParticipants.filter((participant) =>
    `${participant.name} ${participant.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const openPicker = () => {
    setPending(selected);
    setQuery('');
    setPickerMode('full');
  };
  const closePicker = () => {
    returnPickerFocus.current = true;
    setPickerMode(null);
  };
  const submit = () => {
    if (valid) onStart(message, selected);
  };

  return (
    <section
      className={styles.newConversation}
      aria-labelledby="new-conversation-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (pickerMode) closePicker();
          else onCancel();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <header>
        <h1 id="new-conversation-title">New conversation</h1>
        <p>Start a conversation with people and Agents.</p>
      </header>
      <div className={styles.conversationComposerCard}>
        <div className={styles.participantRow}>
          <span className={styles.participantLabel}>To</span>
          <div className={styles.participantChips}>
            {selected.map((id) => {
              const participant = participantById(id)!;
              return (
                <span
                  key={id}
                  className={styles.participantChip}
                  aria-label={`${participant.name}, ${participant.kind === 'agent' ? 'Agent' : 'Person'}`}
                >
                  <span>{participant.name}</span>
                  <button
                    aria-label={`Remove ${participant.name}`}
                    onClick={() =>
                      setSelected((current) => current.filter((value) => value !== id))
                    }
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <label className={styles.participantEntry}>
              <span className={styles.srOnly}>Add People or Agents</span>
              <input
                ref={participantInput}
                role="combobox"
                aria-label="Add People or Agents"
                aria-controls={pickerMode ? 'participant-picker' : undefined}
                aria-expanded={Boolean(pickerMode)}
                placeholder="Add People or Agents"
                value={pickerMode === 'inline' ? query : ''}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPickerMode(event.target.value ? 'inline' : null);
                }}
              />
            </label>
            <button
              ref={add}
              className={styles.addParticipant}
              aria-label="Add People or Agents"
              aria-haspopup="dialog"
              aria-expanded={pickerMode === 'full'}
              onClick={openPicker}
            >
              + Add
            </button>
          </div>
          {pickerMode && (
            <div
              id="participant-picker"
              ref={picker}
              className={styles.participantPicker}
              role="region"
              aria-label="Recent and recommended people and Agents"
            >
              {pickerMode === 'full' && (
                <label>
                  <span className={styles.srOnly}>Search people or Agents</span>
                  <input
                    id="participant-search"
                    type="search"
                    placeholder="Search people or Agents"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
              {(['person', 'agent'] as const).map((kind) => {
                const options = matches.filter((participant) => participant.kind === kind);
                return options.length > 0 ? (
                  <fieldset key={kind}>
                    <legend>{kind === 'person' ? 'People' : 'Agents'}</legend>
                    {options.map((participant) => (
                      <label key={participant.id}>
                        <input
                          type="checkbox"
                          checked={(pickerMode === 'full' ? pending : selected).includes(
                            participant.id,
                          )}
                          onChange={() => {
                            const update = (current: string[]) =>
                              current.includes(participant.id)
                                ? current.filter((id) => id !== participant.id)
                                : [...current, participant.id];
                            if (pickerMode === 'full') setPending(update);
                            else {
                              setSelected(update);
                              setQuery('');
                              setPickerMode(null);
                              participantInput.current?.focus();
                            }
                          }}
                        />
                        <span aria-hidden="true" data-kind={participant.kind}>
                          {participant.initials}
                        </span>
                        <span>
                          <strong>{participant.name}</strong>
                          <small>{participant.description}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null;
              })}
              {matches.length === 0 && <p>No matching participants.</p>}
              {pickerMode === 'full' && (
                <footer>
                  <span aria-live="polite">{pending.length} selected</span>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSelected(pending);
                      setPickerMode(null);
                      composer.current?.focus();
                    }}
                  >
                    Apply
                  </Button>
                </footer>
              )}
            </div>
          )}
        </div>
        <div className={styles.composer}>
          <label className={styles.srOnly} htmlFor="new-conversation-message">
            Message
          </label>
          <textarea
            ref={composer}
            id="new-conversation-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask a question, request work, or coordinate a review…"
          />
          <div className={styles.composerTools}>
            <button disabled aria-describedby="mention-unavailable">
              @ Mention
            </button>
            <small id="mention-unavailable" className={styles.srOnly}>
              Mentions are not implemented.
            </small>
            <span>⌘↵</span>
          </div>
        </div>
      </div>
      <footer className={styles.creationActions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} onClick={submit}>
          Start conversation
        </Button>
      </footer>
    </section>
  );
}
