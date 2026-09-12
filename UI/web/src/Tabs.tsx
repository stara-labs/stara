import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Status } from '@stara/ui';
import type { WorkingContext } from './fixtures';
import styles from './shell.module.css';

interface Props {
  contexts: Record<string, WorkingContext>;
  open: string[];
  active: string;
  mobile: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onPicker: () => void;
}

export function Tabs({ contexts, open, active, mobile, onOpen, onClose, onMove, onPicker }: Props) {
  const working = open.filter((id) => id !== 'home');
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(open.length);
  useEffect(() => {
    const element = ref.current!;
    const measure = () => {
      const css = getComputedStyle(element);
      const minimum = parseFloat(css.getPropertyValue('--stara-tab-minimum-width'));
      const available = element.clientWidth - parseFloat(css.paddingRight) - 34;
      if (minimum > 0) setCapacity(Math.max(1, Math.floor(available / minimum)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  let visible = working.slice(0, capacity);
  if (active !== 'home' && !visible.includes(active)) visible = [...visible.slice(0, -1), active];
  if (mobile) visible = active === 'home' ? [] : [active];

  function focusTab(id: string) {
    onOpen(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  }

  return (
    <div ref={ref} className={styles.tabs}>
      {/* Explicit ownership keeps adjacent close commands outside the tab composite. */}
      <div
        role="tablist"
        aria-label="Working contexts"
        aria-owns={visible.map((id) => `tab-${id}`).join(' ')}
        className={styles.srOnly}
      />
      <div className={styles.tablist}>
        {visible.map((id) => {
          const context = contexts[id];
          return (
            <div
              className={styles.tabGroup}
              key={id}
              data-active={active === id}
              data-context-id={id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const dragged = event.dataTransfer.getData('text/plain');
                if (open.includes(dragged)) onMove(dragged, open.indexOf(id));
              }}
            >
              <button
                className={styles.tab}
                role="tab"
                id={`tab-${id}`}
                aria-controls={`panel-${id}`}
                aria-selected={active === id}
                aria-label={`${context.title}, ${context.statusLabel}`}
                title={context.title}
                tabIndex={active === id || (active === 'home' && id === visible[0]) ? 0 : -1}
                onClick={() => onOpen(id)}
                onKeyDown={(event) => {
                  const index = working.indexOf(id);
                  const delta = event.key === 'ArrowLeft' ? -1 : 1;
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    if (event.altKey) onMove(id, open.indexOf(id) + delta);
                    else focusTab(working[(index + delta + working.length) % working.length]);
                  } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    focusTab(working[event.key === 'Home' ? 0 : working.length - 1]);
                  } else if (event.key === 'Delete') {
                    event.preventDefault();
                    onClose(id);
                  } else if (
                    (event.key === 'Enter' || event.key === ' ') &&
                    event.target === event.currentTarget
                  ) {
                    event.preventDefault();
                    onOpen(id);
                  }
                }}
              >
                <Icon name={context.icon} />
                <span>{context.title}</span>
                <Status state={context.status} compact>
                  {context.statusLabel}
                </Status>
              </button>
              <IconButton
                className={styles.tabClose}
                icon="close"
                label={`Close ${context.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(id);
                }}
              />
            </div>
          );
        })}
      </div>
      <IconButton
        icon={mobile ? 'chevronDown' : 'more'}
        label="Working contexts"
        className={styles.overflow}
        onClick={onPicker}
        aria-haspopup="dialog"
      />
    </div>
  );
}
