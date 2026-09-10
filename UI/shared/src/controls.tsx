import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import styles from './primitives.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
};

export function Button({ variant = 'quiet', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: Omit<ButtonProps, 'children'> & { icon: IconName; label: string }) {
  const id = useId();
  return (
    <span className={`${styles.tool} ${className}`}>
      <button
        type="button"
        {...props}
        className={styles.iconButton}
        aria-label={label}
        aria-describedby={id}
      >
        <Icon name={icon} />
      </button>
      <span role="tooltip" id={id} className={styles.tooltip}>
        {label}
      </span>
    </span>
  );
}

export type OperationalState =
  'running' | 'waiting' | 'attention' | 'failed' | 'completed' | 'unread';

export function Status({
  state,
  children,
  compact = false,
}: {
  state: OperationalState;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className={styles.status} data-state={state}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={compact ? styles.srOnly : undefined}>{children}</span>
    </span>
  );
}

export function TextArea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <textarea id={id} {...props} />
    </label>
  );
}

export function Dialog({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const origin = document.activeElement as HTMLElement;
    ref.current!.showModal();
    return () => {
      if (origin.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <IconButton icon="close" label={`Close ${title}`} onClick={onDismiss} />
      </header>
      {children}
    </dialog>
  );
}
