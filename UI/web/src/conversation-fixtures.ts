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
    name: 'Responsible lead',
    initials: 'RL',
    kind: 'person',
    description: 'Owns the decision and coordinates the next human review.',
  },
  {
    id: 'human-contributor',
    name: 'Human contributor',
    initials: 'HC',
    kind: 'person',
    description: 'Contributes context and reviews prepared material.',
  },
  {
    id: 'intake-agent',
    name: 'Intake Agent',
    initials: 'IA',
    kind: 'agent',
    description: 'Compares permitted intake sources without changing them.',
  },
  {
    id: 'evidence-researcher',
    name: 'Product Evidence Researcher',
    initials: 'ER',
    kind: 'agent',
    description: 'Organizes permitted evidence for responsible human review.',
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
