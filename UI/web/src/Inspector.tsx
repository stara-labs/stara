import { useLayoutEffect, useRef } from 'react';
import { Button, Status } from '@stara/ui';
import type { WorkingContext } from './fixtures';
import type { ContextMemory, LocalView } from './workspace';
import { SourceComparison } from './ContextContent';
import styles from './shell.module.css';

const views: LocalView[] = ['Context', 'Sources', 'Activity'];

export function Inspector({
  context,
  memory,
  onRemember,
  onOpen,
  overlay,
  width,
  onWidth,
  scroll,
  onScroll,
}: {
  context: WorkingContext;
  memory: ContextMemory;
  onRemember: (patch: Partial<ContextMemory>) => void;
  onOpen: (id: string) => void;
  overlay: boolean;
  width?: number;
  onWidth: (width: number) => void;
  scroll: number;
  onScroll: (scroll: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const address = context.id === 'home' || context.id === 'intake' || context.id === 'knowledge';
  const Title = overlay ? 'h1' : 'h2';
  const Subheading = overlay ? 'h2' : 'h3';
  useLayoutEffect(() => {
    content.current!.scrollTop = scroll;
  }, [context.id, scroll]);

  function resize(raw: number, element: HTMLElement) {
    const css = getComputedStyle(element);
    const minimum = parseFloat(css.getPropertyValue('--stara-frame-context-minimum'));
    const maximum = parseFloat(css.getPropertyValue('--stara-frame-context-maximum'));
    const centerMinimum = parseFloat(css.getPropertyValue('--stara-frame-center-minimum'));
    const nav = document
      .querySelector('[aria-label="Global navigation"]')!
      .getBoundingClientRect().width;
    const available = window.innerWidth - nav - centerMinimum;
    onWidth(Math.max(minimum, Math.min(raw, maximum, available)));
  }

  return (
    <aside
      className={styles.inspector}
      aria-label="Context panel"
      id="context-panel"
      data-overlay={overlay}
    >
      {!overlay && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize context panel"
          aria-orientation="vertical"
          aria-valuemin={296}
          aria-valuemax={464}
          aria-valuenow={width ?? 336}
          className={styles.resizer}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const step = parseFloat(
                getComputedStyle(event.currentTarget).getPropertyValue('--stara-space-4'),
              );
              resize(
                (width ?? event.currentTarget.parentElement!.getBoundingClientRect().width) +
                  (event.key === 'ArrowLeft' ? step : -step),
                event.currentTarget,
              );
            }
          }}
          onPointerDown={(event) => {
            start.current = {
              x: event.clientX,
              width: event.currentTarget.parentElement!.getBoundingClientRect().width,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (start.current)
              resize(start.current.width + start.current.x - event.clientX, event.currentTarget);
          }}
          onPointerUp={(event) => {
            start.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
        />
      )}
      <div className={styles.localViews} role="tablist" aria-label="Context views">
        {views.map((view, index) => (
          <button
            key={view}
            role="tab"
            id={`view-${view}`}
            aria-controls={`view-content-${view}`}
            aria-selected={memory.view === view}
            tabIndex={memory.view === view ? 0 : -1}
            onClick={() => onRemember({ view })}
            onKeyDown={(event) => {
              if (
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight' ||
                event.key === 'Home' ||
                event.key === 'End'
              ) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 2
                      : (index + (event.key === 'ArrowLeft' ? -1 : 1) + 3) % 3;
                onRemember({ view: views[next] });
                document.getElementById(`view-${views[next]}`)!.focus();
              }
            }}
          >
            {view}
          </button>
        ))}
      </div>
      <div
        ref={content}
        className={styles.inspectorContent}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        <div
          role="tabpanel"
          id={`view-content-${memory.view}`}
          aria-labelledby={`view-${memory.view}`}
        >
          <section className={styles.inspectionSummary}>
            <Status state={address ? 'attention' : context.status}>
              {address ? 'Needs attention' : context.statusLabel}
            </Status>
            <Title tabIndex={-1} data-inspection-heading>
              {address ? 'Which address should govern this form?' : context.title}
            </Title>
            <p>
              {address
                ? 'The uploaded agreement and the current client record contain different billing addresses.'
                : context.summary}
            </p>
          </section>
          {memory.view === 'Context' && (
            <>
              {address && (
                <SourceComparison
                  name="inspection-source"
                  value={memory.source}
                  onChange={(source) => onRemember({ source })}
                />
              )}
              <section className={styles.detailSection}>
                <Subheading>
                  {address ? 'Why the agreement is recommended' : 'Responsibility'}
                </Subheading>
                <p>
                  {address
                    ? 'The agreement is newer and was supplied for this intake. Responsible lead must decide which source governs the form.'
                    : `Lead: ${context.lead}. Contributions do not transfer decision authority.`}
                </p>
                <Button onClick={() => onRemember({ view: 'Sources' })}>
                  View supporting evidence
                </Button>
              </section>
              <section className={styles.detailSection}>
                <Subheading>Decision boundary</Subheading>
                <p>
                  Comparison only. Selecting a source does not change the draft form, authorize an
                  action, or update a source record.
                </p>
                <p>Simulated fixture. No external action is available.</p>
              </section>
            </>
          )}
          {memory.view === 'Sources' && (
            <>
              <SourceComparison
                name="inspection-source"
                value={memory.source}
                onChange={(source) => onRemember({ source })}
              />
              <section className={styles.detailSection}>
                <Subheading>Source authority</Subheading>
                <p>
                  Each source remains authoritative for its own record. This fixture makes no
                  freshness or permission claim about a connected system.
                </p>
                <p>Current form field: 200 Sample Avenue</p>
              </section>
              <Button onClick={() => onOpen('knowledge')}>Open in Knowledge</Button>
            </>
          )}
          {memory.view === 'Activity' && (
            <section className={styles.detailSection}>
              <Subheading>Fixture activity</Subheading>
              <p>Intake Agent prepared a source comparison.</p>
              <p>Responsible lead has not decided the governing source.</p>
              <p>No external write or verification has occurred.</p>
            </section>
          )}
        </div>
      </div>
      <footer className={styles.panelFooter}>
        <span>Simulation</span>
        <Button onClick={() => onOpen(address ? 'intake' : context.id)}>
          Open {address ? 'activity' : 'context'}
        </Button>
      </footer>
    </aside>
  );
}
