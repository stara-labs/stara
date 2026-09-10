import {
  Home,
  BriefcaseBusiness,
  MessageSquare,
  LayoutGrid,
  BookOpen,
  Users,
  PanelLeft,
  PanelRight,
  Sun,
  Moon,
  Search,
  Plus,
  X,
  Ellipsis,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  GripVertical,
} from 'lucide-react';

const icons = {
  home: Home,
  work: BriefcaseBusiness,
  conversation: MessageSquare,
  app: LayoutGrid,
  knowledge: BookOpen,
  agents: Users,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  sun: Sun,
  moon: Moon,
  search: Search,
  plus: Plus,
  close: X,
  more: Ellipsis,
  left: ArrowLeft,
  right: ArrowRight,
  up: ArrowUp,
  down: ArrowDown,
  chevronDown: ChevronDown,
  grip: GripVertical,
};
export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" focusable="false" size={16} strokeWidth={1.75} />;
}
