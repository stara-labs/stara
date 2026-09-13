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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const returnPickerFocus = useRef(false);
  const valid = message.trim().length > 0;

  useEffect(() => composer.current?.focus(), []);
  useEffect(() => {
    if (pickerOpen) document.getElementById('participant-search')?.focus();
    else if (returnPickerFocus.current) {
      add.current?.focus();
      returnPickerFocus.current = false;
    }
  }, [pickerOpen]);
  useEffect(() => {
    if (!pickerOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node) && event.target !== add.current)
        setPickerOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [pickerOpen]);

  const matches = conversationParticipants.filter((participant) =>
    `${participant.name} ${participant.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const openPicker = () => {
    setPending(selected);
    setQuery('');
    setPickerOpen(true);
  };
  const closePicker = () => {
    returnPickerFocus.current = true;
    setPickerOpen(false);
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
          if (pickerOpen) closePicker();
          else onCancel();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <header>
        <h1 id="new-conversation-title">New Conversation</h1>
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
                  <span aria-hidden="true" data-kind={participant.kind}>
                    {participant.initials}
                  </span>
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
            <button
              ref={add}
              className={styles.addParticipant}
              aria-label="Add participants"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={openPicker}
            >
              + Add
            </button>
          </div>
          {pickerOpen && (
            <div
              ref={picker}
              className={styles.participantPicker}
              role="dialog"
              aria-label="Add participants"
            >
              <label>
                <span className={styles.srOnly}>Search participants</span>
                <input
                  id="participant-search"
                  type="search"
                  placeholder="Search people and Agents"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {(['person', 'agent'] as const).map((kind) => {
                const options = matches.filter((participant) => participant.kind === kind);
                return options.length > 0 ? (
                  <fieldset key={kind}>
                    <legend>{kind === 'person' ? 'People' : 'Agents'}</legend>
                    {options.map((participant) => (
                      <label key={participant.id}>
                        <input
                          type="checkbox"
                          checked={pending.includes(participant.id)}
                          onChange={() =>
                            setPending((current) =>
                              current.includes(participant.id)
                                ? current.filter((id) => id !== participant.id)
                                : [...current, participant.id],
                            )
                          }
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
              <footer>
                <span aria-live="polite">{pending.length} selected</span>
                <Button
                  variant="primary"
                  onClick={() => {
                    setSelected(pending);
                    closePicker();
                  }}
                >
                  Apply
                </Button>
              </footer>
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
            <span>⌘/Ctrl + Enter to start</span>
          </div>
        </div>
      </div>
      <p className={styles.creationBoundary}>
        Synthetic and session only. Starting does not contact a person, invoke an Agent, or write
        externally.
      </p>
      <footer className={styles.creationActions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} onClick={submit}>
          Start Conversation
        </Button>
      </footer>
    </section>
  );
}
