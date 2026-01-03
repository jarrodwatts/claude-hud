import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useHudState } from './hooks/useHudState.js';
import { useElapsedTime } from './hooks/useElapsedTime.js';
import { ContextMeter } from './components/ContextMeter.js';
import { ToolStream } from './components/ToolStream.js';
import { TodoList } from './components/TodoList.js';
import { AgentList } from './components/AgentList.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';
import { ContextInfo } from './components/ContextInfo.js';
import { CostDisplay } from './components/CostDisplay.js';
import type { ConnectionStatus } from './lib/event-reader.js';
import type { PanelId } from './lib/hud-config.js';
import { getHiddenPanelSet, resolvePanelOrder } from './state/hud-selectors.js';

interface AppProps {
  sessionId: string;
  fifoPath: string;
  initialTranscriptPath?: string;
  schemaBannerVisibleMs?: number;
  schemaBannerSuppressMs?: number;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connecting: 'yellow',
  connected: 'green',
  disconnected: 'gray',
  error: 'red',
};

const STATUS_ICONS: Record<ConnectionStatus, string> = {
  connecting: '◐',
  connected: '●',
  disconnected: '○',
  error: '✗',
};

const DEFAULT_SCHEMA_BANNER_VISIBLE_MS = 10000;
const DEFAULT_SCHEMA_BANNER_SUPPRESS_MS = 5 * 60 * 1000;

export function App({
  sessionId,
  fifoPath,
  initialTranscriptPath,
  schemaBannerVisibleMs,
  schemaBannerSuppressMs,
}: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout?.rows || 24);
  const [visible, setVisible] = useState(true);
  const [showSchemaBanner, setShowSchemaBanner] = useState(false);
  const schemaHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schemaSuppressUntilRef = useRef(0);
  const lastSchemaErrorTsRef = useRef<number | null>(null);

  const state = useHudState({ fifoPath, sessionId, initialTranscriptPath });
  const sessionStart = state.context.sessionStart || state.now;
  const elapsed = useElapsedTime(sessionStart, state.now);

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setVisible((v) => !v);
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  useEffect(() => {
    if (!stdout) return;
    const handleResize = () => setTermRows(stdout.rows || 24);
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  useEffect(() => {
    return () => {
      if (schemaHideTimeoutRef.current) {
        clearTimeout(schemaHideTimeoutRef.current);
        schemaHideTimeoutRef.current = null;
      }
    };
  }, []);

  const schemaError = [...state.errors]
    .reverse()
    .find((error) => error.code === 'schema_version_mismatch');

  const bannerVisibleMs = schemaBannerVisibleMs ?? DEFAULT_SCHEMA_BANNER_VISIBLE_MS;
  const bannerSuppressMs = schemaBannerSuppressMs ?? DEFAULT_SCHEMA_BANNER_SUPPRESS_MS;

  useEffect(() => {
    if (!schemaError) {
      setShowSchemaBanner(false);
      return;
    }
    if (lastSchemaErrorTsRef.current === schemaError.ts) {
      return;
    }
    lastSchemaErrorTsRef.current = schemaError.ts;

    const now = Date.now();
    if (now < schemaSuppressUntilRef.current) {
      return;
    }

    setShowSchemaBanner(true);
    if (schemaHideTimeoutRef.current) {
      clearTimeout(schemaHideTimeoutRef.current);
    }
    schemaHideTimeoutRef.current = setTimeout(() => {
      setShowSchemaBanner(false);
      schemaSuppressUntilRef.current = Date.now() + bannerSuppressMs;
    }, bannerVisibleMs);
  }, [schemaError?.ts, bannerSuppressMs, bannerVisibleMs]);

  if (!visible) {
    return (
      <Box>
        <Text dimColor>HUD hidden (Ctrl+H to show)</Text>
      </Box>
    );
  }

  const hiddenPanels = getHiddenPanelSet(state.config);
  const panelOrder = resolvePanelOrder(state.config);
  const panelWidth = state.config?.width || 48;
  const lastError = state.errors[state.errors.length - 1];
  const errorSuffix = state.errors.length > 1 ? ` (+${state.errors.length - 1} more)` : '';
  const schemaContext = schemaError?.context as
    | { schemaVersion?: number; expected?: number }
    | undefined;
  const schemaDetail =
    schemaContext?.schemaVersion && schemaContext?.expected
      ? `v${schemaContext.schemaVersion} (expected v${schemaContext.expected})`
      : schemaError?.message;
  const showGenericError =
    lastError && lastError.code !== 'schema_version_mismatch' && !showSchemaBanner;

  const panels: Record<PanelId, React.ReactNode> = {
    status: (
      <ErrorBoundary>
        <StatusBar
          settings={state.settings}
          isIdle={state.sessionInfo.isIdle}
          cwd={state.sessionInfo.cwd}
          parseErrorCount={state.parseErrorCount}
        />
      </ErrorBoundary>
    ),
    context: (
      <ErrorBoundary>
        <ContextMeter context={state.context} />
      </ErrorBoundary>
    ),
    cost: (
      <ErrorBoundary>
        <CostDisplay cost={state.cost} model={state.model} />
      </ErrorBoundary>
    ),
    contextInfo: (
      <ErrorBoundary>
        <ContextInfo contextFiles={state.contextFiles} />
      </ErrorBoundary>
    ),
    tools: (
      <ErrorBoundary>
        <ToolStream tools={state.tools} />
      </ErrorBoundary>
    ),
    agents: (
      <ErrorBoundary>
        <AgentList agents={state.agents} now={state.now} />
      </ErrorBoundary>
    ),
    todos: (
      <ErrorBoundary>
        <TodoList todos={state.todos} />
      </ErrorBoundary>
    ),
  };

  return (
    <Box
      flexDirection="column"
      width={panelWidth}
      height={termRows}
      borderStyle="round"
      borderColor="gray"
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {' '}
          Claude HUD{' '}
        </Text>
        <Text dimColor>({elapsed}) </Text>
        {state.safeMode && (
          <Text color="red" bold>
            SAFE
          </Text>
        )}
        <Text color={STATUS_COLORS[state.connectionStatus]}>
          {STATUS_ICONS[state.connectionStatus]}
        </Text>
      </Box>

      {state.safeMode && state.safeModeReason && (
        <Box marginBottom={1}>
          <Text color="red">Safe mode: </Text>
          <Text dimColor>{state.safeModeReason}</Text>
        </Box>
      )}

      {showSchemaBanner && schemaError && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow">Schema mismatch</Text>
          <Text dimColor>{schemaDetail || 'Event schema mismatch detected.'}</Text>
          <Text dimColor>Update claude-hud to restore compatibility.</Text>
        </Box>
      )}

      {showGenericError && lastError && (
        <Box marginBottom={1}>
          <Text color="red">Event error: </Text>
          <Text dimColor>
            {lastError.message}
            {errorSuffix}
          </Text>
        </Box>
      )}

      {state.connectionStatus === 'disconnected' && (
        <Box marginBottom={1}>
          <Text dimColor>Waiting for session... (run claude or /resume)</Text>
        </Box>
      )}

      {state.connectionStatus === 'connecting' && (
        <Box marginBottom={1}>
          <Text color="yellow">Connecting to session...</Text>
        </Box>
      )}

      {panelOrder.map((panel) => {
        if (hiddenPanels.has(panel)) return null;
        return <React.Fragment key={panel}>{panels[panel]}</React.Fragment>;
      })}
    </Box>
  );
}
