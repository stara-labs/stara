import { useMemo, useState } from 'react';
import { Button, Status } from '@stara/ui';
import type { OperationalState } from '@stara/ui';
import styles from './shell.module.css';

type HomeView = 'attention' | 'progress' | 'completed';
type HomeSort = 'priority' | 'oldest' | 'updated';
export type HomeDataState = 'ready' | 'loading' | 'error' | 'empty';

interface HomeItem {
  id: string;
  view: HomeView;
  work: string;
  outcome: string;
  lead: string;
  team: string;
  lifecycle: OperationalState;
  lifecycleLabel: string;
  attention?: string;
  updated: string;
  updatedMinutes: number;
  priority: number;
  action: string;
  conversation: string;
}

// Synthetic, session-only coordination fixtures. They never represent verified Work.
export const homeItems: HomeItem[] = [
  {
    id: 'evidence-boundary',
    view: 'attention',
    work: 'Approve partner evidence boundary',
    outcome: 'Human approval is required before the evidence review can continue.',
    lead: 'Responsible lead',
    team: 'Evidence Researcher',
    lifecycle: 'running',
    lifecycleLabel: 'In progress',
    attention: 'Approval required',
    updated: '24m ago',
    updatedMinutes: 24,
    priority: 1,
    action: 'Review',
    conversation: 'conversation',
  },
  {
    id: 'source-conflict',
    view: 'attention',
    work: 'Resolve client intake source conflict',
    outcome: 'Choose the governing address so the intake draft can advance.',
    lead: 'Responsible lead',
    team: 'Intake Agent · Evidence Researcher',
    lifecycle: 'running',
    lifecycleLabel: 'In progress',
    attention: 'Blocked',
    updated: '42m ago',
    updatedMinutes: 42,
    priority: 2,
    action: 'Review',
    conversation: 'intake-conversation',
  },
  {
    id: 'partner-brief',
    view: 'progress',
    work: 'Prepare design-partner brief',
    outcome: 'Create a review-ready brief with an explicit evidence boundary.',
    lead: 'Responsible lead',
    team: 'Evidence Researcher',
    lifecycle: 'running',
    lifecycleLabel: 'In progress',
    updated: '12m ago',
    updatedMinutes: 12,
    priority: 1,
    action: 'Open',
    conversation: 'conversation',
  },
  {
    id: 'onboarding-plan',
    view: 'progress',
    work: 'Prepare client onboarding plan',
    outcome: 'Define the responsible lead, scope, and evidence for review.',
    lead: 'Responsible lead',
    team: 'Onboarding Agent',
    lifecycle: 'waiting',
    lifecycleLabel: 'Waiting',
    updated: '1h ago',
    updatedMinutes: 60,
    priority: 2,
    action: 'Open',
    conversation: 'onboarding-conversation',
  },
  {
    id: 'permitted-sources',
    view: 'progress',
    work: 'Compare permitted research sources',
    outcome: 'Separate source evidence from researcher inference.',
    lead: 'Human contributor',
    team: 'Evidence Researcher',
    lifecycle: 'running',
    lifecycleLabel: 'In progress',
    updated: '2h ago',
    updatedMinutes: 120,
    priority: 3,
    action: 'Open',
    conversation: 'research',
  },
  {
    id: 'accepted-scope',
    view: 'completed',
    work: 'Record accepted onboarding scope',
    outcome: 'Keep the accepted scope available for the next coordination step.',
    lead: 'Responsible lead',
    team: 'Onboarding Agent',
    lifecycle: 'completed',
    lifecycleLabel: 'Completed',
    updated: '18m ago',
    updatedMinutes: 18,
    priority: 1,
    action: 'View',
    conversation: 'onboarding-conversation',
  },
];

const views: { id: HomeView; label: string }[] = [
  { id: 'attention', label: 'Needs Your Attention' },
  { id: 'progress', label: 'In Progress' },
  { id: 'completed', label: 'Recently Completed' },
];

const sorts: Record<HomeView, { value: HomeSort; label: string }[]> = {
  attention: [
    { value: 'priority', label: 'Priority' },
    { value: 'oldest', label: 'Oldest attention' },
    { value: 'updated', label: 'Recently updated' },
  ],
  progress: [
    { value: 'updated', label: 'Recently updated' },
    { value: 'priority', label: 'Priority' },
  ],
  completed: [{ value: 'updated', label: 'Recently completed' }],
};

function ordered(items: HomeItem[], sort: HomeSort) {
  return [...items].sort((left, right) => {
    if (sort === 'priority') return left.priority - right.priority;
    if (sort === 'oldest') return right.updatedMinutes - left.updatedMinutes;
    return left.updatedMinutes - right.updatedMinutes;
  });
}

export function Home({
  selected,
  onSelect,
  onOpen,
  dataState = 'ready',
  onRetry,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  dataState?: HomeDataState;
  onRetry?: () => void;
}) {
  const [view, setView] = useState<HomeView>('attention');
  const [sort, setSort] = useState<HomeSort>('priority');
  const visibleItems = useMemo(
    () =>
      ordered(
        homeItems.filter((item) => item.view === view),
        sort,
      ),
    [sort, view],
  );

  const chooseView = (next: HomeView) => {
    setView(next);
    setSort(sorts[next][0].value);
  };

  return (
    <div className={styles.home}>
      <header className={styles.homeTitleRail}>
        <h1>Home</h1>
      </header>
      <div className={styles.homeViewRail}>
        <div role="tablist" aria-label="Home views" className={styles.homeViews}>
          {views.map((candidate) => {
            const count = homeItems.filter((item) => item.view === candidate.id).length;
            return (
              <button
                key={candidate.id}
                id={`home-view-${candidate.id}`}
                role="tab"
                aria-label={`${candidate.label}, ${count} ${count === 1 ? 'item' : 'items'}`}
                aria-selected={view === candidate.id}
                aria-controls="home-collection"
                tabIndex={view === candidate.id ? 0 : -1}
                onClick={() => chooseView(candidate.id)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const index = views.findIndex((item) => item.id === candidate.id);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? views.length - 1
                        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + views.length) %
                          views.length;
                  chooseView(views[next].id);
                  document.getElementById(`home-view-${views[next].id}`)?.focus();
                }}
              >
                {candidate.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <label className={styles.homeSort}>
          <span className={styles.srOnly}>Sort Home</span>
          <select
            aria-label="Sort Home"
            value={sort}
            onChange={(event) => setSort(event.target.value as HomeSort)}
          >
            {sorts[view].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div id="home-collection" role="tabpanel" aria-labelledby={`home-view-${view}`}>
        {dataState === 'loading' && (
          <p className={styles.homeState}>Loading synthetic Home items…</p>
        )}
        {dataState === 'error' && (
          <div className={styles.homeState} role="alert">
            <p>Synthetic Home items could not be loaded. No verified Work is shown.</p>
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
        {(dataState === 'empty' || (dataState === 'ready' && visibleItems.length === 0)) && (
          <p className={styles.homeState}>No synthetic items are in this view.</p>
        )}
        {dataState === 'ready' && visibleItems.length > 0 && (
          <div className={styles.homeTableFrame}>
            <table className={styles.homeTable} aria-label="Home coordination collection">
              <thead>
                <tr>
                  <th scope="col">Work</th>
                  <th scope="col">Lead</th>
                  <th scope="col">Team</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} data-selected={selected === item.id}>
                    <td>
                      <span className={styles.homeRowMark} aria-hidden="true">
                        <Status state={item.attention ? 'attention' : item.lifecycle} compact>
                          {item.attention ?? item.lifecycleLabel}
                        </Status>
                      </span>
                      <button
                        className={styles.homeWork}
                        aria-pressed={selected === item.id}
                        onClick={() => onSelect(item.id)}
                      >
                        <strong>{item.work}</strong>
                        <span>{item.outcome}</span>
                      </button>
                    </td>
                    <td data-label="Lead">{item.lead}</td>
                    <td data-label="Team">{item.team}</td>
                    <td data-label="Status">
                      <span className={styles.homeStatus}>
                        <Status state={item.lifecycle}>{item.lifecycleLabel}</Status>
                        {item.attention && <small>{item.attention}</small>}
                      </span>
                    </td>
                    <td data-label="Updated">
                      <time>{item.updated}</time>
                    </td>
                    <td data-label="Action">
                      <Button
                        variant={view === 'attention' ? 'secondary' : 'quiet'}
                        aria-label={`${item.action}: ${item.work}`}
                        onClick={() => {
                          onSelect(item.id);
                          onOpen(item.conversation);
                        }}
                      >
                        {item.action}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={styles.homeDisclosure}>
        Synthetic fixtures · Session only · Outcomes are not externally verified
      </p>
    </div>
  );
}
