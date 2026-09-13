import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon, IconButton, Status } from '@stara/ui';
import { contexts as seededContexts } from './fixtures';
import { createWorkspace, workspaceReducer } from './workspace';
import type { ContextMemory } from './workspace';
import { Tabs } from './Tabs';
import { Home } from './Home';
import { homeAttentionLabel } from './home-fixtures';
import { conversationTitle, seededConversations } from './conversation-fixtures';
import type { ConversationRecord } from './conversation-fixtures';
import { Conversations } from './Conversations';
import { NewConversation } from './NewConversation';
import { ContextContent } from './ContextContent';
import { ContextPicker } from './ContextPicker';
import { Inspector } from './Inspector';
import { useMedia } from './useMedia';
import { StagingNotice } from './StagingNotice';
import type { PublicRuntimeConfig } from './runtime-config';
import styles from './shell.module.css';

export function App({
  environment = 'development',
}: { environment?: PublicRuntimeConfig['environment'] } = {}) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createWorkspace);
  const [contexts, setContexts] = useState(seededContexts);
  const [conversations, setConversations] = useState<ConversationRecord[]>(seededConversations);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [navOverride, setNavOverride] = useState<boolean | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const panelScroll = useRef<Record<string, number>>({});
  const origins = useRef<Record<string, HTMLElement>>({});
  const contentFocus = useRef<Record<string, HTMLElement>>({});
  const creationOrigin = useRef<HTMLElement | null>(null);
  const pendingCreatedFocus = useRef<string | null>(null);
  const wasCreating = useRef(false);
  const collapsedDefault = useMedia('(max-width: 1100px)');
  const overlay = useMedia('(max-width: 900px)');
  const mobile = useMedia('(max-width: 700px)');
  const current = contexts[state.active];
  const memory = state.memory[state.active];
  const panelVisible = memory.inspector;
  const collapsed =
    (panelVisible && !overlay && collapsedDefault) || (navOverride ?? collapsedDefault);
  const layerOpen = overlay && panelVisible;
  const staging = environment === 'staging';
  const noticeInFrame = staging && picker === null;

  function remember(patch: Partial<ContextMemory>, id = state.active) {
    dispatch({ type: 'remember', id, patch });
  }
  function open(id: string) {
    const focused = document.activeElement as HTMLElement;
    if (document.getElementById(`panel-${state.active}`)?.contains(focused))
      contentFocus.current[state.active] = focused;
    dispatch({ type: 'open', id });
  }
  function close(id: string) {
    dispatch({ type: 'close', id });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[id^="tab-"][role="tab"][aria-selected="true"]')
        ?.focus(),
    );
  }
  function hideDetails() {
    remember({ inspector: false });
    requestAnimationFrame(() => {
      const origin = origins.current[state.active];
      if (origin?.isConnected && !origin.closest('[hidden]')) origin.focus();
      else document.getElementById(`tab-${state.active}`)?.focus();
    });
  }
  function inspect(origin: HTMLElement) {
    origins.current[state.active] = origin;
    remember({ inspector: true });
  }
  function create(origin: HTMLElement) {
    if (creating) return;
    creationOrigin.current = origin;
    setCreating(true);
  }
  function cancelCreation() {
    setCreating(false);
  }
  function startConversation(message: string, participantIds: string[]) {
    const id = `session-conversation-${conversations.length + 1}`;
    const title = conversationTitle(message);
    const conversation: ConversationRecord = {
      id,
      title,
      message: message.trim(),
      participantIds,
      statusLabel: 'Session only',
      synthetic: true,
      sessionOnly: true,
      executing: false,
    };
    setConversations((current) => [...current, conversation]);
    setContexts((current) => ({
      ...current,
      [id]: {
        id,
        title,
        kind: 'Conversation',
        icon: 'conversation',
        status: 'waiting',
        statusLabel: 'Session only',
        lead: 'You',
        summary: 'A synthetic session Conversation. No participant was contacted.',
        originalMessage: conversation.message,
        participantIds,
        verified: false,
      },
    }));
    setCreating(false);
    pendingCreatedFocus.current = id;
    open(id);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (wasCreating.current && !creating && creationOrigin.current?.isConnected)
      creationOrigin.current.focus();
    wasCreating.current = creating;
  }, [creating]);
  useEffect(() => {
    if (pendingCreatedFocus.current !== state.active || creating) return;
    document.querySelector<HTMLElement>(`#panel-${state.active} h1`)?.focus();
    pendingCreatedFocus.current = null;
  }, [contexts, creating, state.active]);
  useEffect(() => {
    if (panelVisible) document.querySelector<HTMLElement>('[data-inspection-heading]')?.focus();
  }, [panelVisible, state.active]);
  useEffect(() => {
    const previous = contentFocus.current[state.active];
    if (!panelVisible && previous?.isConnected) previous.focus();
  }, [state.active, panelVisible]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    function transform() {
      if (media.matches) {
        for (const id of Object.keys(state.memory))
          dispatch({ type: 'remember', id, patch: { inspector: false } });
        requestAnimationFrame(() => document.getElementById(`tab-${state.active}`)?.focus());
      }
    }
    media.addEventListener('change', transform);
    return () => media.removeEventListener('change', transform);
  }, [state.active, state.memory]);

  return (
    <div
      className={styles.shell}
      data-collapsed={collapsed}
      data-mobile={mobile}
      data-environment={environment}
      data-notice-in-frame={noticeInFrame}
      onKeyDown={(event) => {
        if (picker !== null || creating) return;
        if (event.key === 'Escape' && panelVisible) {
          event.preventDefault();
          hideDetails();
        }
        if (event.key === 'Tab' && layerOpen) {
          const targets = Array.from(
            document.querySelectorAll<HTMLElement>(
              '#context-panel button:not([tabindex="-1"]), #context-panel input:checked, [data-frame-controls] button',
            ),
          );
          const first = targets[0];
          const last = targets.at(-1);
          const focused = document.activeElement;
          if (event.shiftKey && (focused === first || !targets.includes(focused as HTMLElement))) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && focused === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <a className={styles.skip} href={`#panel-${state.active}`}>
        Skip to workspace
      </a>
      {noticeInFrame && (
        <header className={styles.environmentHeader}>
          <StagingNotice />
        </header>
      )}
      <aside className={styles.navigation} aria-label="Global navigation" inert={layerOpen}>
        <header className={styles.brand}>
          <strong>Stara</strong>
          <div className={styles.brandTools}>
            <IconButton
              icon="conversation"
              label="New conversation"
              onClick={(event) => create(event.currentTarget)}
            />
            <IconButton icon="search" label="Search contexts" onClick={() => setPicker('')} />
            <IconButton
              icon="panelLeft"
              label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              onClick={() => setNavOverride(!collapsed)}
            />
          </div>
        </header>
        <nav aria-label="Destinations">
          <button
            className={styles.navRow}
            title={`Home, ${homeAttentionLabel}`}
            aria-label={`Home, ${homeAttentionLabel}`}
            aria-current={state.active === 'home' ? 'page' : undefined}
            onClick={() => open('home')}
          >
            <Icon name="home" />
            <span>Home</span>
            <Status state="attention" compact>
              {homeAttentionLabel}
            </Status>
          </button>
          <button
            className={styles.navRow}
            title="Conversations"
            aria-label="Conversations"
            aria-current={state.active === 'conversations' ? 'page' : undefined}
            onClick={() => open('conversations')}
          >
            <Icon name="conversation" />
            <span>Conversations</span>
          </button>
        </nav>
      </aside>
      <main
        className={styles.workspace}
        data-inspector={panelVisible && !overlay}
        style={
          {
            '--context-width': widths[state.active] ? `${widths[state.active]}px` : undefined,
          } as CSSProperties
        }
      >
        <div className={styles.tabArea} inert={layerOpen}>
          <Tabs
            contexts={contexts}
            open={state.open}
            active={state.active}
            mobile={mobile}
            onOpen={open}
            onClose={close}
            onMove={(id, to) => dispatch({ type: 'move', id, to })}
            onPicker={() => setPicker('')}
          />
        </div>
        <div className={styles.frameControls} data-frame-controls>
          {mobile && (
            <>
              <IconButton
                icon="home"
                label={`Home, ${homeAttentionLabel}`}
                onClick={() => open('home')}
              />
              <IconButton
                icon="conversation"
                label="New conversation"
                onClick={(event) => create(event.currentTarget)}
              />
            </>
          )}
          <IconButton
            icon={theme === 'dark' ? 'sun' : 'moon'}
            label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
          <IconButton
            icon="panelRight"
            label={panelVisible ? 'Hide details' : 'Show details'}
            aria-expanded={panelVisible}
            aria-controls="context-panel"
            onClick={(event) => (panelVisible ? hideDetails() : inspect(event.currentTarget))}
          />
        </div>
        <div className={styles.center} inert={layerOpen}>
          {creating && <NewConversation onCancel={cancelCreation} onStart={startConversation} />}
          {Object.keys(state.memory).map((id) => (
            <section
              key={id}
              id={`panel-${id}`}
              role="tabpanel"
              aria-label={contexts[id].title}
              tabIndex={-1}
              hidden={creating || state.active !== id}
              className={styles.contextPanel}
            >
              {id === 'home' || id === 'conversations' ? null : (
                <header className={styles.workspaceHeader}>
                  <h1 tabIndex={-1}>{contexts[id].title}</h1>
                  <span>{contexts[id].kind}</span>
                </header>
              )}
              <div
                className={styles.centerScroll}
                role="region"
                aria-label={`${contexts[id].title} content`}
              >
                {id === 'home' ? (
                  <Home
                    selected={state.memory.home.selected}
                    onSelect={(selected) => remember({ selected }, 'home')}
                    onOpen={open}
                  />
                ) : id === 'conversations' ? (
                  <Conversations conversations={conversations} onCreate={create} onOpen={open} />
                ) : (
                  <ContextContent
                    context={contexts[id]}
                    memory={state.memory[id]}
                    onRemember={(patch) => remember(patch, id)}
                    onInspect={inspect}
                  />
                )}
                <p className={styles.simulation}>
                  Simulated workspace | Synthetic fixtures | Session only
                </p>
              </div>
            </section>
          ))}
        </div>
        {layerOpen && <div className={styles.scrim} aria-hidden="true" />}
        {panelVisible && (
          <Inspector
            context={current}
            memory={memory}
            onRemember={remember}
            overlay={overlay}
            onOpen={(id) => {
              remember({ inspector: false });
              open(id);
            }}
            width={widths[state.active]}
            onWidth={(width) => setWidths((previous) => ({ ...previous, [state.active]: width }))}
            scroll={panelScroll.current[state.active] ?? 0}
            onScroll={(scroll) => {
              panelScroll.current[state.active] = scroll;
            }}
          />
        )}
      </main>
      <div role="status" aria-live="polite" className={styles.srOnly}>
        {state.announcement}
      </div>
      {picker !== null && (
        <ContextPicker
          environment={environment}
          contexts={contexts}
          open={state.open}
          filter={picker}
          onOpen={open}
          onDismiss={() => setPicker(null)}
          onMove={(id, to) => dispatch({ type: 'move', id, to })}
        />
      )}
    </div>
  );
}
