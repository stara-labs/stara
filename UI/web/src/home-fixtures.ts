import type { OperationalState } from '@stara/ui';

export type HomeFixtureView = 'attention' | 'progress' | 'completed';

export interface HomeFixtureItem {
  id: string;
  view: HomeFixtureView;
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
export const homeItems: HomeFixtureItem[] = [
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

export const homeAttentionCount = homeItems.filter((item) => item.view === 'attention').length;
export const homeAttentionLabel = `${homeAttentionCount} items need attention`;
