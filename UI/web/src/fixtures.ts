import type { IconName, OperationalState } from '@stara/ui';
import { homeAttentionLabel } from './home-fixtures';

export interface WorkingContext {
  id: string;
  title: string;
  kind: 'Home' | 'Work' | 'Conversation' | 'App activity' | 'Knowledge';
  icon: IconName;
  status: OperationalState;
  statusLabel: string;
  lead: string;
  summary: string;
  verified: false;
  draftOnly?: boolean;
}

// Synthetic coordination records. These values never represent live execution.
export const contexts: Record<string, WorkingContext> = {
  home: {
    id: 'home',
    title: 'Home',
    kind: 'Home',
    icon: 'home',
    status: 'attention',
    statusLabel: homeAttentionLabel,
    lead: 'Responsible lead',
    summary: 'Attention and coordination',
    verified: false,
  },
  work: {
    id: 'work',
    title: 'Prepare client onboarding plan',
    kind: 'Work',
    icon: 'work',
    status: 'running',
    statusLabel: 'In progress',
    lead: 'Responsible lead',
    summary:
      'Prepare an onboarding plan with a responsible lead, agreed scope, and evidence for the next review.',
    verified: false,
  },
  conversation: {
    id: 'conversation',
    title: 'Design-partner preparation',
    kind: 'Conversation',
    icon: 'conversation',
    status: 'running',
    statusLabel: 'In progress',
    lead: 'Responsible lead',
    summary:
      'Coordinate the partner brief with Human contributor, Intake Agent, and Product Evidence Researcher.',
    verified: false,
  },
  intake: {
    id: 'intake',
    title: 'Resolve client intake',
    kind: 'App activity',
    icon: 'app',
    status: 'attention',
    statusLabel: 'Needs attention',
    lead: 'Responsible lead',
    summary:
      'Choose which source should govern the billing address in the draft client intake form.',
    verified: false,
  },
  research: {
    id: 'research',
    title: 'Research evidence boundary',
    kind: 'Conversation',
    icon: 'conversation',
    status: 'unread',
    statusLabel: 'Unread material',
    lead: 'Human contributor',
    summary: 'Separate permitted sources, researcher inference, and claims awaiting human review.',
    verified: false,
  },
  'intake-conversation': {
    id: 'intake-conversation',
    title: 'Client intake source decision',
    kind: 'Conversation',
    icon: 'conversation',
    status: 'attention',
    statusLabel: 'Decision needed',
    lead: 'Responsible lead',
    summary:
      'Review the synthetic source conflict without changing either source or creating an external effect.',
    verified: false,
  },
  'onboarding-conversation': {
    id: 'onboarding-conversation',
    title: 'Client onboarding coordination',
    kind: 'Conversation',
    icon: 'conversation',
    status: 'running',
    statusLabel: 'In progress',
    lead: 'Responsible lead',
    summary: 'Coordinate the synthetic onboarding scope and evidence boundary for human review.',
    verified: false,
  },
  knowledge: {
    id: 'knowledge',
    title: 'Onboarding source review',
    kind: 'Knowledge',
    icon: 'knowledge',
    status: 'waiting',
    statusLabel: 'Review pending',
    lead: 'Responsible lead',
    summary: 'Compare the agreement and account record without changing either source.',
    verified: false,
  },
};

export const sources = [
  {
    id: 'agreement',
    title: 'Signed client agreement',
    freshness: 'Updated today',
    provenance: 'Uploaded by Responsible lead',
    address: '100 Example Way',
    use: 'Supplied specifically for this intake. Recommended by Intake Agent.',
  },
  {
    id: 'record',
    title: 'Client account record',
    freshness: 'Updated 12 days ago',
    provenance: 'Company Knowledge snapshot',
    address: '200 Sample Avenue',
    use: 'Current draft form value. Its governing status has not been decided.',
  },
] as const;

export const messages = [
  {
    name: 'Responsible lead',
    role: 'Decision owner',
    text: 'Keep the onboarding scope bounded. Bring any source conflict back for review before changing the form.',
  },
  {
    name: 'Human contributor',
    role: 'Contributor',
    text: 'The partner brief should make the evidence boundary explicit. A prepared recommendation is not an accepted claim.',
  },
  {
    name: 'Intake Agent',
    role: 'Contributor',
    text: 'The agreement and account record disagree on the billing address. I have prepared a comparison for the responsible lead.',
  },
  {
    name: 'Product Evidence Researcher',
    role: 'Contributor',
    text: 'Comparing three permitted sources for the brief. Human review of the result is expected today.',
  },
];
