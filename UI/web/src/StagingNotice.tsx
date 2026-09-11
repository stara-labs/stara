import styles from './shell.module.css';

export function StagingNotice() {
  return (
    <div role="note" aria-label="Staging environment" className={styles.stagingNotice}>
      Internal staging. Synthetic data only. Drafts are temporary and may be lost on reload or when
      this page closes.
    </div>
  );
}
