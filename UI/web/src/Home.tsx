import { useMemo, useState } from 'react';
import { Button, Status } from '@stara/ui';
import { homeItems } from './home-fixtures';
import type { HomeFixtureItem } from './home-fixtures';
import styles from './shell.module.css';

type HomeView = 'attention' | 'progress' | 'completed';
type HomeSort = 'priority' | 'oldest' | 'updated';
export type HomeDataState = 'ready' | 'loading' | 'error' | 'empty';

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

function ordered(items: HomeFixtureItem[], sort: HomeSort) {
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
                        aria-label={`${item.work} ${item.outcome}`}
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
                        variant="quiet"
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
