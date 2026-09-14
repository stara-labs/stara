export type ParticipantKind = 'person' | 'agent';

export interface ConversationParticipant {
  id: string;
  name: string;
  initials: string;
  kind: ParticipantKind;
  description: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  message: string;
  participantIds: string[];
  statusLabel: string;
  synthetic: true;
  sessionOnly: true;
  executing: false;
}

// Synthetic feature fixtures. They are local values, not backend responses.
export const conversationParticipants: ConversationParticipant[] = [
  {
    id: 'responsible-lead',
    name: 'Customer lead',
    initials: 'CL',
    kind: 'person',
    description: 'Product direction and review',
  },
  {
    id: 'human-contributor',
    name: 'Operations Lead',
    initials: 'OL',
    kind: 'person',
    description: 'Coordinates onboarding and delivery',
  },
  {
    id: 'intake-agent',
    name: 'Intake Agent',
    initials: 'IA',
    kind: 'agent',
    description: 'Structures client material and flags conflicts',
  },
  {
    id: 'evidence-researcher',
    name: 'Evidence Researcher',
    initials: 'ER',
    kind: 'agent',
    description: 'Finds, attributes, and tests permitted evidence',
  },
  {
    id: 'product-agent',
    name: 'Product Agent',
    initials: 'PA',
    kind: 'agent',
    description: 'Synthesizes accepted evidence into reviewable recommendations',
  },
];

export const seededConversations: ConversationRecord[] = [
  {
    id: 'conversation',
    title: 'Design-partner preparation',
    message: 'Keep the evidence boundary explicit in the partner brief.',
    participantIds: ['responsible-lead', 'human-contributor', 'intake-agent'],
    statusLabel: 'In progress',
    synthetic: true,
    sessionOnly: true,
    executing: false,
  },
  {
    id: 'research',
    title: 'Research evidence boundary',
    message: 'Separate permitted sources from claims awaiting human review.',
    participantIds: ['human-contributor', 'evidence-researcher'],
    statusLabel: 'Unread material',
    synthetic: true,
    sessionOnly: true,
    executing: false,
  },
  {
    id: 'intake-conversation',
    title: 'Client intake source decision',
    message: 'Review the source conflict without changing either source.',
    participantIds: ['responsible-lead', 'intake-agent'],
    statusLabel: 'Decision needed',
    synthetic: true,
    sessionOnly: true,
    executing: false,
  },
];

export const seededContributions = [
  {
    participantId: 'responsible-lead',
    role: 'Decision owner',
    text: 'Keep the onboarding scope bounded. Bring any source conflict back for review before changing the form.',
  },
  {
    participantId: 'human-contributor',
    role: 'Contributor',
    text: 'The partner brief should make the evidence boundary explicit. A prepared recommendation is not an accepted claim.',
  },
  {
    participantId: 'intake-agent',
    role: 'Contributor',
    text: 'The agreement and account record disagree. I prepared a comparison for the responsible lead.',
  },
  {
    participantId: 'evidence-researcher',
    role: 'Contributor',
    text: 'Comparing permitted sources for the brief. Human review is expected.',
  },
] as const;

export function conversationTitle(message: string) {
  const normalized = message.trim().replace(/\s+/g, ' ');
  return normalized.length <= 44 ? normalized : `${normalized.slice(0, 41).trimEnd()}…`;
}

export function participantById(id: string) {
  return conversationParticipants.find((participant) => participant.id === id);
}
