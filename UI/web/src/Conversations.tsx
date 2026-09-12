import { Button, Status } from '@stara/ui';
import type { ConversationRecord } from './conversation-fixtures';
import styles from './shell.module.css';

export function Conversations({
  conversations,
  onCreate,
  onOpen,
}: {
  conversations: ConversationRecord[];
  onCreate: (origin: HTMLElement) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={styles.conversations}>
      <header className={styles.destinationHeader}>
        <h1>Conversations</h1>
        <Button variant="primary" onClick={(event) => onCreate(event.currentTarget)}>
          New Conversation
        </Button>
      </header>
      <div className={styles.conversationCollection} aria-label="Conversations collection">
        {conversations.map((conversation) => (
          <article key={conversation.id} className={styles.conversationRow}>
            <button
              aria-label={`Open ${conversation.title}`}
              onClick={() => onOpen(conversation.id)}
            >
              <strong>{conversation.title}</strong>
              <span>{conversation.message}</span>
            </button>
            <Status state="running">{conversation.statusLabel}</Status>
          </article>
        ))}
      </div>
      <p className={styles.homeDisclosure}>Synthetic fixtures · Session only · Not persistent</p>
    </div>
  );
}
