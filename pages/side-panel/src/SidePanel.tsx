/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import {
  type ChatMessage,
  type EvidenceSpace,
  type Message,
  type TaskCommand,
  type TaskSnapshot,
  Actors,
  AgentNameEnum,
  ProviderTypeEnum,
  chatHistoryStore,
  agentModelStore,
  llmProviderStore,
  getEvidenceSpace,
} from '@extension/storage';
import favoritesStorage, { type FavoriteItem, type FavoriteSkill } from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import { TaskStatusCard } from './components/TaskStatusCard';
import FirstRunSetup from './components/FirstRunSetup';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import { shouldPersistExecutionEvent } from './event-persistence';
import { mergeTaskSnapshot } from './task-snapshot';
import { PROGRESS_MESSAGE_CONTENT, classifyAgentEvent, shouldMergeFailure } from './presentation/humanize-message';
import {
  formatBindChip,
  formatBindDetail,
  pickActiveContentTab,
  taskBoundContentTab,
  type BoundContentTab,
} from './presentation/active-tab-bind';
import {
  isActiveTaskStatus,
  shouldAutoRestoreTaskSession,
  shouldShowMainTaskSurface,
} from './presentation/task-loop-ui';
import { completionChatDelivery, hasCompletionChatDelivery } from './presentation/completion-chat-delivery';
import { isStatusOnlyAnswer } from './presentation/goal-coverage';
import { taskAllowsDirectionChange, taskLocksComposer, taskNeedsDirectStop } from './presentation/wait-affordance';
import {
  cancellationIntentAfterDisconnect,
  cancellationIntentAfterDispatch,
  canBeginExclusiveTaskLaunch,
  canExposeMessageRecoveryActions,
  canFollowUpInOwnedSession,
  canDispatchTaskCommand,
  confirmsNewChatCancellation,
  hasPendingLifecycleCommand,
  historicalProjectionAfterHistoryBack,
  isCurrentAsyncSessionResult,
  isRejectedTaskLaunchAck,
  mergeAuthoritativeTaskSnapshot,
  modelHistoryForTurn,
  newChatCancellationTarget,
  ownsAsyncSessionOperation,
  pendingStartAfterPostFailure,
  projectMessagesForDisplay,
  protectedLiveHistorySessionId,
  recoverySessionOwner,
  shouldAcceptHistorySnapshot,
  shouldAcceptTaskSignal,
  shouldRenderMessageForSession,
  shouldRenderCommandRejection,
  shouldDeleteSupersededLaunchSession,
  shouldRetryNewChatCancellationAfterLifecycleAck,
  shouldSuppressExecutionForSessionRecovery,
  shouldSuppressLegacyTaskOk,
} from './presentation/session-task-identity';
import './SidePanel.css';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

type CommandRejection = 'not_found' | 'stale_revision' | 'invalid_transition' | 'invalid_input';

export function commandRejectionMessage(error: CommandRejection): string {
  switch (error) {
    case 'stale_revision':
      return t('chat_task_command_stale');
    case 'invalid_transition':
      return t('chat_task_command_invalid_transition');
    case 'not_found':
      return t('chat_task_command_not_found');
    case 'invalid_input':
      return t('chat_task_command_invalid_input');
  }
}

/** A new-chat reset is safe only after the old live task has acknowledged cancellation. */
export { confirmsNewChatCancellation, shouldAcceptTaskSignal } from './presentation/session-task-identity';

/** Resolve the content tab the user is looking at (not chrome:// / extension pages). */
export async function resolveActiveContentTab(
  options: { allowLastFocused?: boolean } = {},
): Promise<BoundContentTab | null> {
  const attempts: Array<{ query: chrome.tabs.QueryInfo; requireActive: boolean }> = [
    { query: { active: true, currentWindow: true }, requireActive: true },
    // Side panel as a tab makes itself active. Still bind the page in this window.
    { query: { currentWindow: true }, requireActive: false },
  ];
  if (options.allowLastFocused !== false) {
    attempts.push({ query: { active: true, lastFocusedWindow: true }, requireActive: true });
  }
  for (const { query, requireActive } of attempts) {
    try {
      const tabs = await chrome.tabs.query(query);
      const bound = pickActiveContentTab(tabs, { requireActive });
      if (bound) return bound;
    } catch {
      /* try next query */
    }
  }
  return null;
}

const SidePanel = () => {
  const progressMessage = PROGRESS_MESSAGE_CONTENT;
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [favoritePrompts, setFavoritePrompts] = useState<FavoriteItem[]>([]);
  const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null); // null = loading, false = no models, true = has models
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshot | null>(null);
  const [evidenceSpace, setEvidenceSpace] = useState<EvidenceSpace | null>(null);
  const [taskSnapshotLoaded, setTaskSnapshotLoaded] = useState(false);
  /** Live preview of the content tab that will receive the next task (Phase 1 S1). */
  const [bindPreview, setBindPreview] = useState<BoundContentTab | null>(null);
  /** S4: while a live task owns the console, chat stays folded unless the user expands it. */
  const [chatLogExpanded, setChatLogExpanded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const setupConnectionRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const pendingDirectionChangeRef = useRef(false);
  const pendingTaskIdRef = useRef<string | null>(null);
  const pendingStartCommandRef = useRef<{ taskId: string; commandId: string } | null>(null);
  const pendingHistoryTaskIdRef = useRef<string | null>(null);
  const pendingNewChatCancellationRef = useRef<{ taskId: string; commandId: string | null } | null>(null);
  const dismissedTaskIdsRef = useRef(new Set<string>());
  const sessionGenerationRef = useRef(0);
  const taskSnapshotRef = useRef<TaskSnapshot | null>(null);
  const authoritativeTaskSnapshotRef = useRef<TaskSnapshot | null>(null);
  const isHistoricalSessionRef = useRef(false);
  const finalizeNewChatRef = useRef<(cancelledTaskId?: string) => void>(() => undefined);
  const requestNewChatCancellationRef = useRef<(taskId: string, revision: number) => void>(() => undefined);
  const autoRestoreRequestRef = useRef(0);
  const completionDeliveryRequestRef = useRef(0);
  const historySelectionRequestRef = useRef(0);
  const bookmarkRequestRef = useRef(0);
  const taskLaunchRequestRef = useRef(0);
  const pendingAsyncLaunchRef = useRef<{
    kind: 'message' | 'skill';
    generation: number;
    requestToken: number;
    sessionId?: string | null;
  } | null>(null);
  const recoveringAuthoritativeTaskRef = useRef(false);
  const recoverySessionOwnerRef = useRef<ReturnType<typeof recoverySessionOwner>>(null);
  const pendingTaskCommandsRef = useRef(
    new Map<string, { commandId: string; taskId: string; type: TaskCommand['type'] }>(),
  );
  const [pendingCommandTypes, setPendingCommandTypes] = useState<ReadonlySet<TaskCommand['type']>>(() => new Set());
  const [taskLaunchPending, setTaskLaunchPending] = useState(false);
  const deliveredCompletionReceiptsRef = useRef(new Set<string>());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const pendingUserTurnRef = useRef(
    new Map<
      string,
      {
        resolve: (d: { kind: string; userVisibleText: string }) => void;
        reject: (e: Error) => void;
      }
    >(),
  );

  const refreshBindPreview = useCallback(async () => {
    const bound = await resolveActiveContentTab({ allowLastFocused: false });
    setBindPreview(bound);
  }, []);

  const activeTaskId = taskSnapshot && isActiveTaskStatus(taskSnapshot.status) ? taskSnapshot.id : null;
  taskSnapshotRef.current = taskSnapshot;
  isHistoricalSessionRef.current = isHistoricalSession;

  const finalizeNewChat = useCallback((cancelledTaskId?: string) => {
    if (cancelledTaskId) dismissedTaskIdsRef.current.add(cancelledTaskId);
    pendingNewChatCancellationRef.current = null;
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);
    isHistoricalSessionRef.current = false;
    setTaskSnapshot(null);
    taskSnapshotRef.current = null;
    authoritativeTaskSnapshotRef.current = null;
    setEvidenceSpace(null);
    setChatLogExpanded(false);
    pendingTaskIdRef.current = null;
    pendingStartCommandRef.current = null;
    pendingHistoryTaskIdRef.current = null;
    pendingDirectionChangeRef.current = false;
    historySelectionRequestRef.current += 1;
    bookmarkRequestRef.current += 1;
    taskLaunchRequestRef.current += 1;
    pendingAsyncLaunchRef.current = null;
    recoveringAuthoritativeTaskRef.current = false;
    recoverySessionOwnerRef.current = null;
    setTaskLaunchPending(false);
    pendingTaskCommandsRef.current.clear();
    setPendingCommandTypes(new Set());
    sessionGenerationRef.current += 1;
  }, []);
  finalizeNewChatRef.current = finalizeNewChat;

  // New live task (or task id change) starts with chat folded so Mission/Now/Health stay first.
  useEffect(() => {
    if (activeTaskId) setChatLogExpanded(false);
  }, [activeTaskId]);

  useEffect(() => {
    void refreshBindPreview();
    const onFocus = () => {
      void refreshBindPreview();
    };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => {
      void refreshBindPreview();
    }, 2_500);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [refreshBindPreview]);

  // Executable model config: agent assignment + provider credentials (or Ollama).
  const checkModelConfiguration = useCallback(async () => {
    try {
      const configuredAgents = await agentModelStore.getConfiguredAgents();
      if (configuredAgents.length === 0) {
        setHasConfiguredModels(false);
        return;
      }
      const all = await agentModelStore.getAllAgentModels();
      const primary = all[AgentNameEnum.Navigator] || all[AgentNameEnum.Planner];
      if (!primary?.provider || !primary?.modelName) {
        setHasConfiguredModels(false);
        return;
      }
      const provider = await llmProviderStore.getProvider(primary.provider);
      if (!provider) {
        setHasConfiguredModels(false);
        return;
      }
      const needsKey = provider.type !== ProviderTypeEnum.Ollama;
      if (needsKey && !(provider.apiKey || '').trim()) {
        setHasConfiguredModels(false);
        return;
      }
      setHasConfiguredModels(true);
    } catch (error) {
      console.error('Error checking model configuration:', error);
      setHasConfiguredModels(false);
    }
  }, []);

  // Check model configuration on mount
  useEffect(() => {
    checkModelConfiguration();
  }, [checkModelConfiguration]);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Panel became visible, re-check configuration
        checkModelConfiguration();
      }
    };

    const handleFocus = () => {
      // Panel gained focus, re-check configuration
      checkModelConfiguration();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const appendMessage = useCallback(
    async (
      newMessage: Message,
      sessionId?: string | null,
      storedContent?: string,
      persist = true,
      replaceVisible = false,
    ): Promise<ChatMessage | null> => {
      if (sessionId === undefined && isHistoricalSessionRef.current) return null;
      const isProgressMessage = newMessage.content === progressMessage;
      const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;
      if (shouldRenderMessageForSession(sessionId, sessionIdRef.current)) {
        setMessages(prev => {
          if (replaceVisible) return [newMessage];
          const filteredMessages = prev.filter(
            (msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1),
          );
          return [...filteredMessages, newMessage];
        });
      }
      if (!effectiveSessionId || isProgressMessage || !persist) return null;
      return chatHistoryStore.addMessage(effectiveSessionId, {
        ...newMessage,
        content: storedContent ?? newMessage.content,
      });
    },
    [progressMessage],
  );

  useEffect(() => {
    if (!taskSnapshot) return;
    const busy = shouldSuppressExecutionForSessionRecovery(recoverySessionOwnerRef.current, sessionIdRef.current);
    const round = taskSnapshot.rounds.find(item => item.id === taskSnapshot.currentRoundId);
    const requiresExplicitResume = taskLocksComposer(taskSnapshot.status, round?.waitReason);
    setInputEnabled(!busy && !requiresExplicitResume);
    setShowStopButton(taskSnapshot.status === 'running');
    // Follow-up only while the task is still live. Terminal snapshots stay in history;
    // the main surface returns to idle and the next goal starts a new task.
    const followable = isActiveTaskStatus(taskSnapshot.status);
    setIsFollowUpMode(followable && Boolean(taskSnapshot.chatSessionId));
  }, [taskSnapshot]);

  useEffect(() => {
    const taskId = taskSnapshot?.id;
    if (!taskId) {
      setEvidenceSpace(null);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      const next = await getEvidenceSpace(taskId);
      if (!disposed) setEvidenceSpace(next);
    };
    void refresh();
    const interval = taskSnapshot.status === 'running' ? window.setInterval(() => void refresh(), 2_000) : null;
    return () => {
      disposed = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [taskSnapshot?.id, taskSnapshot?.revision, taskSnapshot?.status]);

  useEffect(() => {
    if (!taskSnapshot) return;
    const chatSessionId =
      taskSnapshot.chatSessionId ?? (taskSnapshot.sourceSkillId !== undefined ? taskSnapshot.id : null);
    if (
      !chatSessionId ||
      dismissedTaskIdsRef.current.has(taskSnapshot.id) ||
      !shouldAutoRestoreTaskSession({
        status: taskSnapshot?.status,
        taskChatSessionId: chatSessionId,
        currentSessionId: sessionIdRef.current,
      })
    ) {
      return;
    }
    const taskId = taskSnapshot.id;
    const taskRevision = taskSnapshot.revision;
    const generation = sessionGenerationRef.current;
    const previousSessionId = sessionIdRef.current;
    const requestToken = ++autoRestoreRequestRef.current;
    let disposed = false;
    void chatHistoryStore.getSession(chatSessionId).then(session => {
      const currentTask = taskSnapshotRef.current;
      if (
        !session ||
        dismissedTaskIdsRef.current.has(taskId) ||
        !isCurrentAsyncSessionResult({
          disposed,
          generation,
          currentGeneration: sessionGenerationRef.current,
          requestToken,
          currentRequestToken: autoRestoreRequestRef.current,
          taskId,
          currentTaskId: currentTask?.id,
          taskRevision,
          currentTaskRevision: currentTask?.revision,
          sessionId: chatSessionId,
          currentSessionId: sessionIdRef.current,
          previousSessionId,
        })
      ) {
        return;
      }
      setCurrentSessionId(session.id);
      sessionIdRef.current = session.id;
      setMessages(session.messages);
      setIsHistoricalSession(false);
      isHistoricalSessionRef.current = false;
      if (
        currentTask &&
        recoverySessionOwnerRef.current?.taskId === taskId &&
        recoverySessionOwnerRef.current.sessionId === session.id
      ) {
        recoverySessionOwnerRef.current = null;
        setTaskLaunchPending(false);
        const currentRound = currentTask.rounds.find(round => round.id === currentTask.currentRoundId);
        setInputEnabled(!taskLocksComposer(currentTask.status, currentRound?.waitReason));
      }
    });
    return () => {
      disposed = true;
    };
  }, [taskSnapshot]);

  useEffect(() => {
    const delivery = completionChatDelivery({
      snapshot: taskSnapshot,
      currentSessionId,
      messages: projectMessagesForDisplay(messages),
      isHistoricalSession,
    });
    if (!delivery || deliveredCompletionReceiptsRef.current.has(delivery.receiptId)) return;

    const taskId = taskSnapshot!.id;
    const taskRevision = taskSnapshot!.revision;
    const generation = sessionGenerationRef.current;
    const requestToken = ++completionDeliveryRequestRef.current;
    const deliveredReceipts = deliveredCompletionReceiptsRef.current;
    let disposed = false;
    let committed = false;
    deliveredReceipts.add(delivery.receiptId);
    void chatHistoryStore
      .getSession(delivery.sessionId)
      .then(session => {
        const currentTask = taskSnapshotRef.current;
        if (
          !session ||
          hasCompletionChatDelivery(session.messages, delivery) ||
          dismissedTaskIdsRef.current.has(taskId) ||
          !isCurrentAsyncSessionResult({
            disposed,
            generation,
            currentGeneration: sessionGenerationRef.current,
            requestToken,
            currentRequestToken: completionDeliveryRequestRef.current,
            taskId,
            currentTaskId: currentTask?.id,
            taskRevision,
            currentTaskRevision: currentTask?.revision,
            sessionId: delivery.sessionId,
            currentSessionId: sessionIdRef.current,
          })
        ) {
          return;
        }
        committed = true;
        return appendMessage(
          {
            actor: Actors.SYSTEM,
            content: delivery.content,
            timestamp: delivery.timestamp,
          },
          delivery.sessionId,
        );
      })
      .catch(() => {
        deliveredReceipts.delete(delivery.receiptId);
      });
    return () => {
      disposed = true;
      if (!committed) deliveredReceipts.delete(delivery.receiptId);
    };
  }, [appendMessage, currentSessionId, isHistoricalSession, messages, taskSnapshot]);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      if (shouldSuppressLegacyTaskOk(actor, state)) return;
      if (isHistoricalSessionRef.current) return;
      if (
        shouldSuppressExecutionForSessionRecovery(
          recoverySessionOwnerRef.current,
          sessionIdRef.current,
          recoveringAuthoritativeTaskRef.current,
        )
      ) {
        return;
      }
      if (
        !shouldAcceptTaskSignal({
          taskId: data?.taskId,
          dismissedTaskIds: dismissedTaskIdsRef.current,
          authoritativeTaskId: authoritativeTaskSnapshotRef.current?.id,
          displayedTaskId: taskSnapshotRef.current?.id,
          pendingStartTaskId: pendingStartCommandRef.current?.taskId,
          currentSessionId: sessionIdRef.current,
        })
      ) {
        return;
      }
      const details = data?.details ?? '';

      // Side effects for task lifecycle (input lock, follow-up) - not chat labels
      if (actor === Actors.SYSTEM) {
        switch (state) {
          case ExecutionState.TASK_START:
            setIsHistoricalSession(false);
            break;
          case ExecutionState.TASK_FAIL:
            setIsFollowUpMode(false);
            setInputEnabled(true);
            setShowStopButton(false);
            break;
          case ExecutionState.TASK_CANCEL:
            setIsFollowUpMode(false);
            setInputEnabled(true);
            setShowStopButton(false);
            break;
          default:
            break;
        }
      }

      const ui = classifyAgentEvent({ actor, state, details });

      if (ui.action === 'suppress') {
        return;
      }

      if (ui.action === 'progress') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: progressMessage,
          timestamp,
        });
        return;
      }

      if (ui.action === 'append_failure') {
        const failureMessage: Message = {
          actor: Actors.SYSTEM,
          content: ui.detail ? `${ui.content}\n\n«${ui.detail}»` : ui.content,
          timestamp,
        };
        setMessages(prev => {
          // Drop trailing progress bubble, then merge consecutive failures
          let next = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
          const last = next[next.length - 1];
          if (shouldMergeFailure(last, timestamp)) {
            next = next.slice(0, -1);
          }
          return [...next, failureMessage];
        });
        const sessionId = sessionIdRef.current;
        if (sessionId && shouldPersistExecutionEvent(state)) {
          void chatHistoryStore.addMessage(sessionId, {
            ...failureMessage,
            content: failureMessage.content,
          });
        }
        return;
      }

      if (ui.action === 'append_assistant' || ui.action === 'append_system') {
        appendMessage(
          {
            actor: Actors.SYSTEM,
            content: ui.content,
            timestamp,
          },
          undefined,
          undefined,
          shouldPersistExecutionEvent(state),
        );
      }
    },
    [appendMessage, progressMessage],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current || reconnectTimeoutRef.current) return;
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      setupConnectionRef.current?.();
    }, 500);
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      setTaskSnapshotLoaded(false);
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'task_snapshot') {
          const requestedTaskId = typeof message.requestedTaskId === 'string' ? message.requestedTaskId : null;
          if (message.snapshot) {
            const incoming = message.snapshot as TaskSnapshot;
            const pendingReset = pendingNewChatCancellationRef.current;
            if (requestedTaskId && pendingReset?.taskId === requestedTaskId && incoming.id === requestedTaskId) {
              if (!isActiveTaskStatus(incoming.status)) {
                finalizeNewChatRef.current(incoming.id);
              } else if (!pendingReset?.commandId) {
                requestNewChatCancellationRef.current(incoming.id, incoming.revision);
              }
            } else if (requestedTaskId) {
              if (
                shouldAcceptHistorySnapshot({
                  requestedTaskId,
                  snapshotTaskId: incoming.id,
                  pendingHistoryTaskId: pendingHistoryTaskIdRef.current,
                  currentSessionId: sessionIdRef.current,
                  isHistoricalSession: isHistoricalSessionRef.current,
                })
              ) {
                setTaskSnapshot(incoming);
              }
            } else if (
              shouldAcceptTaskSignal({
                taskId: incoming.id,
                dismissedTaskIds: dismissedTaskIdsRef.current,
                authoritativeTaskId: authoritativeTaskSnapshotRef.current?.id,
                displayedTaskId: isHistoricalSessionRef.current ? null : taskSnapshotRef.current?.id,
                pendingStartTaskId: pendingStartCommandRef.current?.taskId,
                currentSessionId: isHistoricalSessionRef.current ? null : sessionIdRef.current,
                allowBootstrap: true,
                allowAuthoritativeRecovery: recoveringAuthoritativeTaskRef.current,
              })
            ) {
              const wasRecoveringAuthoritativeTask = recoveringAuthoritativeTaskRef.current;
              recoveringAuthoritativeTaskRef.current = false;
              const authoritative = mergeAuthoritativeTaskSnapshot(authoritativeTaskSnapshotRef.current, incoming);
              if (wasRecoveringAuthoritativeTask) {
                recoverySessionOwnerRef.current = isActiveTaskStatus(authoritative.status)
                  ? recoverySessionOwner(authoritative, sessionIdRef.current)
                  : null;
                if (recoverySessionOwnerRef.current) {
                  setInputEnabled(false);
                } else {
                  setTaskLaunchPending(false);
                  setInputEnabled(true);
                }
              }
              if (authoritative !== incoming) {
                setTaskSnapshotLoaded(true);
                return;
              }
              authoritativeTaskSnapshotRef.current = authoritative;
              const replacesPendingStart = pendingStartCommandRef.current?.taskId === incoming.id;
              if (!isHistoricalSessionRef.current) {
                setTaskSnapshot(current =>
                  mergeTaskSnapshot(current, incoming, undefined, replacesPendingStart ? incoming.id : null),
                );
              }
              if (replacesPendingStart) {
                pendingStartCommandRef.current = null;
                pendingTaskIdRef.current = null;
                if (!pendingAsyncLaunchRef.current) setTaskLaunchPending(false);
              }
              if (pendingReset?.taskId === incoming.id) {
                if (!isActiveTaskStatus(incoming.status)) {
                  finalizeNewChatRef.current(incoming.id);
                } else if (isActiveTaskStatus(incoming.status) && !pendingReset.commandId) {
                  requestNewChatCancellationRef.current(incoming.id, incoming.revision);
                }
              }
            }
          } else if (requestedTaskId) {
            if (pendingNewChatCancellationRef.current?.taskId === requestedTaskId) {
              finalizeNewChatRef.current(requestedTaskId);
            } else if (
              pendingHistoryTaskIdRef.current === requestedTaskId &&
              sessionIdRef.current === requestedTaskId
            ) {
              setTaskSnapshot(null);
            }
          } else if (pendingNewChatCancellationRef.current) {
            finalizeNewChatRef.current(pendingNewChatCancellationRef.current.taskId);
          } else {
            recoveringAuthoritativeTaskRef.current = false;
            recoverySessionOwnerRef.current = null;
            pendingStartCommandRef.current = null;
            pendingTaskIdRef.current = null;
            setTaskLaunchPending(false);
            setInputEnabled(true);
            setShowStopButton(false);
          }
          setTaskSnapshotLoaded(true);
        } else if (message && message.type === 'task_event') {
          const incoming = message.event.snapshot as TaskSnapshot;
          const pendingNewChatCancellation = pendingNewChatCancellationRef.current;
          if (
            confirmsNewChatCancellation(pendingNewChatCancellation, {
              taskId: incoming.id,
              status: incoming.status,
            })
          ) {
            // TaskManager persists + broadcasts cancel before dispatch resolves its matching ack.
            finalizeNewChatRef.current(pendingNewChatCancellation?.taskId);
            setTaskSnapshotLoaded(true);
            return;
          }
          if (dismissedTaskIdsRef.current.has(incoming.id)) {
            setTaskSnapshotLoaded(true);
            return;
          }
          if (
            !shouldAcceptTaskSignal({
              taskId: incoming.id,
              dismissedTaskIds: dismissedTaskIdsRef.current,
              authoritativeTaskId: authoritativeTaskSnapshotRef.current?.id,
              displayedTaskId: isHistoricalSessionRef.current ? null : taskSnapshotRef.current?.id,
              pendingStartTaskId: pendingStartCommandRef.current?.taskId,
              currentSessionId: isHistoricalSessionRef.current ? null : sessionIdRef.current,
            })
          ) {
            setTaskSnapshotLoaded(true);
            return;
          }
          const wasRecoveringAuthoritativeTask = recoveringAuthoritativeTaskRef.current;
          const authoritative = mergeAuthoritativeTaskSnapshot(authoritativeTaskSnapshotRef.current, incoming);
          if (wasRecoveringAuthoritativeTask) {
            recoveringAuthoritativeTaskRef.current = false;
            recoverySessionOwnerRef.current = isActiveTaskStatus(authoritative.status)
              ? recoverySessionOwner(authoritative, sessionIdRef.current)
              : null;
            if (recoverySessionOwnerRef.current) {
              setInputEnabled(false);
            } else {
              setTaskLaunchPending(false);
              setInputEnabled(true);
            }
          }
          if (authoritative !== incoming) {
            setTaskSnapshotLoaded(true);
            return;
          }
          authoritativeTaskSnapshotRef.current = authoritative;
          const replacesPendingStart = pendingStartCommandRef.current?.taskId === incoming.id;
          if (!isHistoricalSessionRef.current) {
            setTaskSnapshot(current =>
              mergeTaskSnapshot(current, incoming, message.event, replacesPendingStart ? incoming.id : null),
            );
          }
          if (replacesPendingStart) {
            pendingStartCommandRef.current = null;
            pendingTaskIdRef.current = null;
            if (!pendingAsyncLaunchRef.current) setTaskLaunchPending(false);
          }
          const pendingReset = pendingNewChatCancellationRef.current;
          if (pendingReset?.taskId === incoming.id) {
            if (!isActiveTaskStatus(incoming.status)) {
              finalizeNewChatRef.current(incoming.id);
            } else if (!pendingReset.commandId) {
              requestNewChatCancellationRef.current(incoming.id, incoming.revision);
            }
          }
          setTaskSnapshotLoaded(true);
        } else if (message && message.type === 'command_ack') {
          const pendingNewChatCancellation = pendingNewChatCancellationRef.current;
          const pendingStartCommand = pendingStartCommandRef.current;
          const pendingCommand = pendingTaskCommandsRef.current.get(message.ack.commandId);
          const ownsPendingAck = pendingCommand?.taskId === message.ack.taskId;
          if (
            confirmsNewChatCancellation(pendingNewChatCancellation, {
              taskId: message.ack.taskId,
              commandId: message.ack.commandId,
              accepted: message.ack.accepted,
            })
          ) {
            finalizeNewChatRef.current(pendingNewChatCancellation?.taskId);
            return;
          }
          if (
            !ownsPendingAck &&
            !shouldAcceptTaskSignal({
              taskId: message.ack.taskId,
              dismissedTaskIds: dismissedTaskIdsRef.current,
              authoritativeTaskId: authoritativeTaskSnapshotRef.current?.id,
              displayedTaskId: isHistoricalSessionRef.current ? null : taskSnapshotRef.current?.id,
              pendingStartTaskId: pendingStartCommandRef.current?.taskId,
              currentSessionId: isHistoricalSessionRef.current ? null : sessionIdRef.current,
            })
          ) {
            return;
          }
          if (ownsPendingAck) {
            pendingTaskCommandsRef.current.delete(message.ack.commandId);
            setPendingCommandTypes(new Set([...pendingTaskCommandsRef.current.values()].map(item => item.type)));
          }
          if (
            shouldRetryNewChatCancellationAfterLifecycleAck({
              pending: pendingNewChatCancellationRef.current,
              taskId: message.ack.taskId,
              type: pendingCommand?.type,
              accepted: message.ack.accepted,
            })
          ) {
            requestNewChatCancellationRef.current(message.ack.taskId, message.ack.revision);
          }
          if (message.ack.accepted && pendingStartCommandRef.current?.taskId === message.ack.taskId) {
            // Preserve launch identity/single-flight until its authoritative snapshot arrives.
            if (pendingNewChatCancellation?.taskId === message.ack.taskId) {
              portRef.current?.postMessage({ type: 'get_task', taskId: message.ack.taskId });
            }
          }
          if (!message.ack.accepted) {
            const rejectsTaskLaunch = ownsPendingAck && isRejectedTaskLaunchAck(pendingCommand, message.ack);
            if (
              pendingNewChatCancellation?.taskId === message.ack.taskId &&
              pendingStartCommand?.taskId === message.ack.taskId &&
              pendingStartCommand?.commandId === message.ack.commandId
            ) {
              finalizeNewChatRef.current(message.ack.taskId);
              return;
            }
            const rejectsNewChatCancellation =
              pendingNewChatCancellation?.taskId === message.ack.taskId &&
              pendingNewChatCancellation?.commandId === message.ack.commandId;
            if (pendingNewChatCancellation && rejectsNewChatCancellation) {
              if (message.ack.error === 'not_found') {
                finalizeNewChatRef.current(message.ack.taskId);
                return;
              }
              pendingNewChatCancellationRef.current = {
                taskId: pendingNewChatCancellation.taskId,
                commandId: null,
              };
              setInputEnabled(false);
            }
            if (pendingStartCommandRef.current?.taskId === message.ack.taskId) {
              pendingStartCommandRef.current = null;
              pendingTaskIdRef.current = null;
            }
            if (rejectsTaskLaunch) {
              dismissedTaskIdsRef.current.add(message.ack.taskId);
              recoveringAuthoritativeTaskRef.current = true;
              recoverySessionOwnerRef.current = null;
              pendingAsyncLaunchRef.current = null;
              taskLaunchRequestRef.current += 1;
              setInputEnabled(false);
              setShowStopButton(false);
              setTaskSnapshotLoaded(true);
            }
            portRef.current?.postMessage(
              pendingNewChatCancellationRef.current
                ? { type: 'get_task', taskId: pendingNewChatCancellationRef.current.taskId }
                : { type: 'get_active_task' },
            );
            if (
              !rejectsNewChatCancellation &&
              message.ack.error !== 'stale_revision' &&
              shouldRenderCommandRejection({
                taskId: message.ack.taskId,
                isHistoricalSession: isHistoricalSessionRef.current,
                displayedTaskId: taskSnapshotRef.current?.id,
                currentSessionId: sessionIdRef.current,
              })
            ) {
              void appendMessage({
                actor: Actors.SYSTEM,
                content: commandRejectionMessage(message.ack.error),
                timestamp: Date.now(),
              });
            }
          }
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'speech_to_text_result') {
          // Handle speech-to-text result
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // Handle speech-to-text error
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        } else if (message && message.type === 'user_turn_decision_result') {
          const requestId = typeof message.requestId === 'string' ? message.requestId : '';
          const pending = pendingUserTurnRef.current.get(requestId);
          if (!pending) return;
          pendingUserTurnRef.current.delete(requestId);
          if (message.error) {
            pending.reject(new Error(String(message.error)));
            return;
          }
          const decision = message.decision;
          if (!decision || typeof decision.kind !== 'string' || typeof decision.userVisibleText !== 'string') {
            pending.reject(new Error(t('errors_unknown')));
            return;
          }
          pending.resolve({
            kind: decision.kind,
            userVisibleText: decision.userVisibleText,
          });
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setTaskSnapshotLoaded(false);
        setInputEnabled(true);
        setShowStopButton(false);
        // Keep a requested New Chat across service-worker reconnect; the next
        // authoritative snapshot either confirms cancellation or reissues it.
        if (pendingNewChatCancellationRef.current) {
          pendingNewChatCancellationRef.current = cancellationIntentAfterDisconnect(
            pendingNewChatCancellationRef.current,
          );
          setInputEnabled(false);
        }
        pendingTaskCommandsRef.current.clear();
        setPendingCommandTypes(new Set());
        scheduleReconnect();
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
      const pendingReset = pendingNewChatCancellationRef.current;
      portRef.current.postMessage(
        pendingReset ? { type: 'get_task', taskId: pendingReset.taskId } : { type: 'get_active_task' },
      );
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      // Clear any references since connection failed
      portRef.current = null;
      setTaskSnapshotLoaded(false);
      scheduleReconnect();
    }
  }, [handleTaskState, appendMessage, scheduleReconnect, stopConnection]);

  useEffect(() => {
    isMountedRef.current = true;
    setupConnectionRef.current = setupConnection;
    setupConnection();
    return () => {
      isMountedRef.current = false;
      setupConnectionRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [setupConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  const sendTaskCommand = useCallback(
    (command: TaskCommand) => {
      if (!canDispatchTaskCommand(pendingTaskCommandsRef.current.values(), command)) return false;
      const trackCommand = (nextCommand: TaskCommand) => {
        pendingTaskCommandsRef.current.set(nextCommand.commandId, {
          commandId: nextCommand.commandId,
          taskId: nextCommand.taskId,
          type: nextCommand.type,
        });
        setPendingCommandTypes(new Set([...pendingTaskCommandsRef.current.values()].map(item => item.type)));
      };
      const clearCommand = (commandId: string) => {
        pendingTaskCommandsRef.current.delete(commandId);
        setPendingCommandTypes(new Set([...pendingTaskCommandsRef.current.values()].map(item => item.type)));
      };
      const postCommand = (nextCommand: TaskCommand, tracked = false) => {
        if (nextCommand.type === 'start' || nextCommand.type === 'run_skill') {
          pendingTaskIdRef.current = nextCommand.taskId;
          pendingStartCommandRef.current = { taskId: nextCommand.taskId, commandId: nextCommand.commandId };
        }
        if (!tracked) trackCommand(nextCommand);
        try {
          sendMessage({ type: 'task_command', command: nextCommand });
        } catch (error) {
          clearCommand(nextCommand.commandId);
          const remainingPendingStart = pendingStartAfterPostFailure(pendingStartCommandRef.current, nextCommand);
          if (remainingPendingStart !== pendingStartCommandRef.current) {
            pendingStartCommandRef.current = remainingPendingStart;
            pendingTaskIdRef.current = null;
          }
          throw error;
        }
      };
      postCommand(command);
      return true;
    },
    [appendMessage, sendMessage],
  );

  const requestNewChatCancellation = useCallback(
    (taskId: string, revision: number) => {
      const existing = pendingNewChatCancellationRef.current;
      if (existing?.taskId !== taskId || existing.commandId) return;
      const inFlightCancel = [...pendingTaskCommandsRef.current.values()].find(
        command => command.taskId === taskId && command.type === 'cancel',
      );
      if (inFlightCancel) {
        pendingNewChatCancellationRef.current = { taskId, commandId: inFlightCancel.commandId };
        return;
      }
      const commandId = crypto.randomUUID();
      try {
        const dispatched = sendTaskCommand({ type: 'cancel', commandId, taskId, expectedRevision: revision });
        pendingNewChatCancellationRef.current = cancellationIntentAfterDispatch(taskId, commandId, dispatched);
      } catch (error) {
        pendingNewChatCancellationRef.current = { taskId, commandId: null };
        setInputEnabled(false);
        void appendMessage({
          actor: Actors.SYSTEM,
          content: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    },
    [appendMessage, sendTaskCommand],
  );
  requestNewChatCancellationRef.current = requestNewChatCancellation;

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Handle different commands
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      // Unsupported command
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  const requestUserTurnDecision = useCallback(
    (latestText: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
      return new Promise<{ kind: string; userVisibleText: string }>((resolve, reject) => {
        if (!portRef.current) {
          setupConnection();
        }
        const port = portRef.current;
        if (!port) {
          reject(new Error(t('errors_conn_serviceWorker')));
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(() => {
          pendingUserTurnRef.current.delete(requestId);
          reject(new Error('判断超时，请再试一次。'));
        }, 90000);
        pendingUserTurnRef.current.set(requestId, {
          resolve: d => {
            window.clearTimeout(timer);
            resolve(d);
          },
          reject: e => {
            window.clearTimeout(timer);
            reject(e);
          },
        });
        try {
          port.postMessage({
            type: 'user_turn_decision',
            requestId,
            text: latestText,
            history,
          });
        } catch (error) {
          window.clearTimeout(timer);
          pendingUserTurnRef.current.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    [setupConnection],
  );

  const handleSendMessage = async (text: string, displayText?: string) => {
    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText) return;
    const isDirectionChange = pendingDirectionChangeRef.current;
    pendingDirectionChangeRef.current = false;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }
    if (
      shouldSuppressExecutionForSessionRecovery(
        recoverySessionOwnerRef.current,
        sessionIdRef.current,
        recoveringAuthoritativeTaskRef.current,
      )
    ) {
      return;
    }

    const startingFreshSession = !isFollowUpMode || !sessionIdRef.current;
    if (
      !canBeginExclusiveTaskLaunch({
        pendingAsyncLaunch: pendingAsyncLaunchRef.current !== null,
        pendingStartTaskId: pendingStartCommandRef.current?.taskId,
      })
    ) {
      return;
    }
    const launchOwner = startingFreshSession
      ? {
          kind: 'message' as const,
          generation: ++sessionGenerationRef.current,
          requestToken: ++taskLaunchRequestRef.current,
        }
      : null;
    if (launchOwner) {
      recoveringAuthoritativeTaskRef.current = false;
      recoverySessionOwnerRef.current = null;
      pendingAsyncLaunchRef.current = launchOwner;
      setTaskLaunchPending(true);
    }
    let turnSessionId: string | null = null;
    let launchResolved = !startingFreshSession;
    const turnGeneration = launchOwner?.generation ?? sessionGenerationRef.current;
    try {
      setInputEnabled(false);
      if (startingFreshSession) {
        const supersededTask = taskSnapshotRef.current;
        if (supersededTask && !isActiveTaskStatus(supersededTask.status)) {
          dismissedTaskIdsRef.current.add(supersededTask.id);
          taskSnapshotRef.current = null;
          if (authoritativeTaskSnapshotRef.current?.id === supersededTask.id) {
            authoritativeTaskSnapshotRef.current = null;
          }
          setTaskSnapshot(null);
          setEvidenceSpace(null);
        }
      }
      // Create a chat session when this is a fresh start, or when follow-up has no session yet
      if (startingFreshSession) {
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('newSession', newSession);
        const sessionId = newSession.id;
        if (
          !launchOwner ||
          !ownsAsyncSessionOperation({
            owner: launchOwner,
            currentGeneration: sessionGenerationRef.current,
            currentRequestToken: taskLaunchRequestRef.current,
          })
        ) {
          void chatHistoryStore.deleteSession(sessionId);
          return;
        }
        pendingAsyncLaunchRef.current = { ...launchOwner, sessionId };
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }
      turnSessionId = sessionIdRef.current;
      if (!turnSessionId) throw new Error('Failed to create chat session');

      const userMessage: Message = {
        actor: Actors.USER,
        content: displayText || text,
        timestamp: Date.now(),
      };

      const historyForModel = modelHistoryForTurn(messages, startingFreshSession);

      const storedMessage = await appendMessage(userMessage, turnSessionId, text, true, startingFreshSession);
      if (!storedMessage) throw new Error('Failed to persist message');
      if (turnGeneration !== sessionGenerationRef.current || turnSessionId !== sessionIdRef.current) return;

      if (!portRef.current) {
        setupConnection();
      }

      // LLM decides: reply / clarify / execute / stop (no keyword router)
      const decision = await requestUserTurnDecision(trimmedText, historyForModel);
      // A delayed decision from a superseded chat must never append or start work in the new chat.
      if (turnGeneration !== sessionGenerationRef.current || turnSessionId !== sessionIdRef.current) return;

      if (decision.kind === 'reply' || decision.kind === 'clarify') {
        await appendMessage(
          {
            actor: Actors.SYSTEM,
            content: decision.userVisibleText,
            timestamp: Date.now(),
          },
          turnSessionId,
        );
        setInputEnabled(true);
        setShowStopButton(false);
        launchResolved = true;
        return;
      }

      if (decision.kind === 'stop') {
        if (taskSnapshot && isActiveTaskStatus(taskSnapshot.status)) {
          sendTaskCommand({
            type: 'cancel',
            commandId: crypto.randomUUID(),
            taskId: taskSnapshot.id,
            expectedRevision: taskSnapshot.revision,
          });
        }
        if (decision.userVisibleText) {
          await appendMessage(
            {
              actor: Actors.SYSTEM,
              content: decision.userVisibleText,
              timestamp: Date.now(),
            },
            turnSessionId,
          );
        }
        setInputEnabled(true);
        setShowStopButton(false);
        launchResolved = true;
        return;
      }

      // execute (or unknown kind treated as execute only if model said execute)
      if (decision.kind !== 'execute') {
        await appendMessage(
          {
            actor: Actors.SYSTEM,
            content: decision.userVisibleText || '我没太理解，请再说一遍你想在页面上做什么。',
            timestamp: Date.now(),
          },
          turnSessionId,
        );
        setInputEnabled(true);
        setShowStopButton(false);
        launchResolved = true;
        return;
      }

      if (decision.userVisibleText && !isStatusOnlyAnswer(decision.userVisibleText)) {
        await appendMessage(
          {
            actor: Actors.SYSTEM,
            content: decision.userVisibleText,
            timestamp: Date.now(),
          },
          turnSessionId,
        );
      }

      const currentTask = taskSnapshotRef.current;
      const canFollowUp = canFollowUpInOwnedSession(currentTask, turnSessionId);
      setShowStopButton(true);
      if (canFollowUp && currentTask) {
        sendTaskCommand({
          type: 'follow_up',
          commandId: crypto.randomUUID(),
          taskId: currentTask.id,
          expectedRevision: currentTask.revision,
          instruction: text,
          chatSessionId: turnSessionId,
          instructionMessageId: storedMessage.id,
          changeType: isDirectionChange ? 'direction_change' : 'follow_up',
        });
      } else {
        const bound = await resolveActiveContentTab({ allowLastFocused: false });
        if (turnGeneration !== sessionGenerationRef.current || turnSessionId !== sessionIdRef.current) return;
        setBindPreview(bound);
        if (!bound) throw new Error(t('chat_task_bind_missing'));
        sendTaskCommand({
          type: 'start',
          commandId: crypto.randomUUID(),
          taskId: turnSessionId,
          instruction: text,
          chatSessionId: turnSessionId,
          instructionMessageId: storedMessage.id,
          tabId: bound.tabId,
        });
      }
      launchResolved = true;
    } catch (err) {
      if (turnGeneration !== sessionGenerationRef.current || turnSessionId !== sessionIdRef.current) return;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage(
        {
          actor: Actors.SYSTEM,
          content: errorMessage,
          timestamp: Date.now(),
        },
        turnSessionId,
      );
      setInputEnabled(true);
      setShowStopButton(false);
      launchResolved = true;
    } finally {
      const stillOwnsLaunch = launchOwner
        ? ownsAsyncSessionOperation({
            owner: { ...launchOwner, ...(turnSessionId ? { sessionId: turnSessionId } : {}) },
            currentGeneration: sessionGenerationRef.current,
            currentRequestToken: taskLaunchRequestRef.current,
            currentSessionId: sessionIdRef.current,
          })
        : true;
      if (
        shouldDeleteSupersededLaunchSession({
          startingFreshSession,
          launchResolved,
          stillOwnsLaunch,
          sessionId: turnSessionId,
        })
      ) {
        void chatHistoryStore.deleteSession(turnSessionId!);
      }
      if (launchOwner && pendingAsyncLaunchRef.current?.requestToken === launchOwner.requestToken) {
        pendingAsyncLaunchRef.current = null;
        if (!pendingStartCommandRef.current) setTaskLaunchPending(false);
      }
    }
  };

  const handleStopTask = async () => {
    try {
      const liveTask = authoritativeTaskSnapshotRef.current ?? taskSnapshot;
      if (!liveTask) return;
      const cancelCommand = {
        type: 'cancel' as const,
        commandId: crypto.randomUUID(),
        taskId: liveTask.id,
        expectedRevision: liveTask.revision,
      };
      if (!canDispatchTaskCommand(pendingTaskCommandsRef.current.values(), cancelCommand)) return;
      sendTaskCommand(cancelCommand);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task cancellation error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(false);
    setShowStopButton(false);
  };

  const handlePauseTask = useCallback(() => {
    if (!taskSnapshot || hasPendingLifecycleCommand(pendingCommandTypes)) return;
    sendTaskCommand({
      type: 'pause',
      commandId: crypto.randomUUID(),
      taskId: taskSnapshot.id,
      expectedRevision: taskSnapshot.revision,
    });
  }, [pendingCommandTypes, sendTaskCommand, taskSnapshot]);

  const handleResumeTask = useCallback(() => {
    if (!taskSnapshot || hasPendingLifecycleCommand(pendingCommandTypes)) return;
    sendTaskCommand({
      type: 'resume',
      commandId: crypto.randomUUID(),
      taskId: taskSnapshot.id,
      expectedRevision: taskSnapshot.revision,
    });
  }, [pendingCommandTypes, sendTaskCommand, taskSnapshot]);

  const handleNewChat = () => {
    const authoritative = authoritativeTaskSnapshotRef.current;
    const cancellationTaskId = newChatCancellationTarget({
      authoritativeTask: authoritative ? { taskId: authoritative.id, status: authoritative.status } : null,
      pendingStartTaskId: pendingStartCommandRef.current?.taskId,
      displayedTask: taskSnapshot ? { taskId: taskSnapshot.id, status: taskSnapshot.status } : null,
    });
    if (cancellationTaskId) {
      if (pendingNewChatCancellationRef.current?.taskId === cancellationTaskId) return;
      pendingNewChatCancellationRef.current = { taskId: cancellationTaskId, commandId: null };
      sessionGenerationRef.current += 1;
      setInputEnabled(false);
      const known =
        authoritative?.id === cancellationTaskId
          ? authoritative
          : taskSnapshot?.id === cancellationTaskId
            ? taskSnapshot
            : null;
      if (known) requestNewChatCancellation(cancellationTaskId, known.revision);
      return;
    }
    finalizeNewChat(taskSnapshot?.id ?? authoritative?.id);
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = (reset = false) => {
    historySelectionRequestRef.current += 1;
    bookmarkRequestRef.current += 1;
    pendingHistoryTaskIdRef.current = null;
    const nextHistoricalSession = historicalProjectionAfterHistoryBack(isHistoricalSessionRef.current, reset);
    isHistoricalSessionRef.current = nextHistoricalSession;
    setIsHistoricalSession(nextHistoricalSession);
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    const requestToken = ++historySelectionRequestRef.current;
    const generation = ++sessionGenerationRef.current;
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (requestToken !== historySelectionRequestRef.current || generation !== sessionGenerationRef.current) return;
      if (fullSession && fullSession.messages.length > 0) {
        dismissedTaskIdsRef.current.delete(sessionId);
        setCurrentSessionId(fullSession.id);
        sessionIdRef.current = fullSession.id;
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
        isHistoricalSessionRef.current = true;
        pendingHistoryTaskIdRef.current = fullSession.id;
        setTaskSnapshot(null);
        portRef.current?.postMessage({ type: 'get_task', taskId: fullSession.id });
        console.log('history session selected', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      if (sessionId === protectedLiveHistorySessionId(authoritativeTaskSnapshotRef.current)) return;
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === sessionIdRef.current) {
        dismissedTaskIdsRef.current.add(sessionId);
        sessionGenerationRef.current += 1;
        historySelectionRequestRef.current += 1;
        pendingHistoryTaskIdRef.current = null;
        pendingDirectionChangeRef.current = false;
        sessionIdRef.current = null;
        setMessages([]);
        setCurrentSessionId(null);
        setIsHistoricalSession(false);
        isHistoricalSessionRef.current = false;
        setIsFollowUpMode(false);
        setTaskSnapshot(null);
        taskSnapshotRef.current = null;
        setEvidenceSpace(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionBookmark = async (sessionId: string) => {
    const owner = {
      generation: sessionGenerationRef.current,
      requestToken: ++bookmarkRequestRef.current,
      sessionId: sessionIdRef.current,
    };
    const stillOwnsBookmark = () =>
      ownsAsyncSessionOperation({
        owner,
        currentGeneration: sessionGenerationRef.current,
        currentRequestToken: bookmarkRequestRef.current,
        currentSessionId: sessionIdRef.current,
      });
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (stillOwnsBookmark() && fullSession && fullSession.messages.length > 0) {
        // Get the session title
        const sessionTitle = fullSession.title;
        // Get the first 8 words of the title
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // Get the first message content (the task)
        const taskContent = projectMessagesForDisplay(fullSession.messages)[0]?.content || '';

        // Add to favorites storage
        await favoritesStorage.addPrompt(title, taskContent);
        if (!stillOwnsBookmark()) return;

        // Update favorites in the UI
        const prompts = await favoritesStorage.getAllPrompts();
        if (!stillOwnsBookmark()) return;
        setFavoritePrompts(prompts);

        // Return to the projection that owned the history list; bookmarking never resets another task/session.
        handleBackToChat(false);
      }
    } catch (error) {
      console.error('Failed to pin session to favorites:', error);
    }
  };

  const handleBookmarkSelect = (content: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(content);
    }
  };

  const handleSkillRun = async (skill: FavoriteSkill, values: Record<string, string>) => {
    const currentTask = authoritativeTaskSnapshotRef.current ?? taskSnapshotRef.current;
    if (currentTask && isActiveTaskStatus(currentTask.status)) return;
    if (
      !canBeginExclusiveTaskLaunch({
        pendingAsyncLaunch: pendingAsyncLaunchRef.current !== null,
        pendingStartTaskId: pendingStartCommandRef.current?.taskId,
      })
    ) {
      return;
    }
    const launchOwner = {
      kind: 'skill' as const,
      generation: ++sessionGenerationRef.current,
      requestToken: ++taskLaunchRequestRef.current,
    };
    recoveringAuthoritativeTaskRef.current = false;
    recoverySessionOwnerRef.current = null;
    pendingAsyncLaunchRef.current = launchOwner;
    setTaskLaunchPending(true);
    setInputEnabled(false);
    let ownSessionId: string | null = null;
    let launchResolved = false;
    try {
      const session = await chatHistoryStore.createSession(`Skill · ${skill.title}`.slice(0, 50));
      ownSessionId = session.id;
      if (
        !ownsAsyncSessionOperation({
          owner: launchOwner,
          currentGeneration: sessionGenerationRef.current,
          currentRequestToken: taskLaunchRequestRef.current,
        })
      ) {
        return;
      }
      pendingAsyncLaunchRef.current = { ...launchOwner, sessionId: session.id };
      setCurrentSessionId(session.id);
      sessionIdRef.current = session.id;
      setMessages([]);
      setIsHistoricalSession(false);
      isHistoricalSessionRef.current = false;
      setIsFollowUpMode(false);
      setTaskSnapshot(null);
      taskSnapshotRef.current = null;
      authoritativeTaskSnapshotRef.current = null;
      setEvidenceSpace(null);
      pendingHistoryTaskIdRef.current = null;
      const invocation = await chatHistoryStore.addMessage(session.id, {
        actor: Actors.USER,
        content: `运行 Skill：${skill.title}`,
        timestamp: Date.now(),
      });
      if (
        !ownsAsyncSessionOperation({
          owner: { ...launchOwner, sessionId: session.id },
          currentGeneration: sessionGenerationRef.current,
          currentRequestToken: taskLaunchRequestRef.current,
          currentSessionId: sessionIdRef.current,
        })
      ) {
        return;
      }
      setMessages([invocation]);
      if (currentTask && !isActiveTaskStatus(currentTask.status)) dismissedTaskIdsRef.current.add(currentTask.id);
      const bound = await resolveActiveContentTab({ allowLastFocused: false });
      if (
        !ownsAsyncSessionOperation({
          owner: { ...launchOwner, sessionId: session.id },
          currentGeneration: sessionGenerationRef.current,
          currentRequestToken: taskLaunchRequestRef.current,
          currentSessionId: sessionIdRef.current,
        })
      ) {
        return;
      }
      if (!bound) throw new Error(t('chat_task_bind_missing'));
      setShowStopButton(true);
      sendTaskCommand({
        type: 'run_skill',
        commandId: crypto.randomUUID(),
        taskId: session.id,
        skillId: skill.id,
        values,
        tabId: bound.tabId,
      });
      launchResolved = true;
    } catch (error) {
      const ownsFailure = ownsAsyncSessionOperation({
        owner: { ...launchOwner, ...(ownSessionId ? { sessionId: ownSessionId } : {}) },
        currentGeneration: sessionGenerationRef.current,
        currentRequestToken: taskLaunchRequestRef.current,
        currentSessionId: sessionIdRef.current,
      });
      if (!ownsFailure) return;
      launchResolved = true;
      setInputEnabled(true);
      setShowStopButton(false);
      if (ownSessionId) {
        void appendMessage(
          {
            actor: Actors.SYSTEM,
            content: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          },
          ownSessionId,
        );
      }
    } finally {
      const stillOwnsLaunch = ownsAsyncSessionOperation({
        owner: { ...launchOwner, ...(ownSessionId ? { sessionId: ownSessionId } : {}) },
        currentGeneration: sessionGenerationRef.current,
        currentRequestToken: taskLaunchRequestRef.current,
        currentSessionId: sessionIdRef.current,
      });
      if (
        shouldDeleteSupersededLaunchSession({
          startingFreshSession: true,
          launchResolved,
          stillOwnsLaunch,
          sessionId: ownSessionId,
        })
      ) {
        void chatHistoryStore.deleteSession(ownSessionId!);
      }
      if (pendingAsyncLaunchRef.current?.requestToken === launchOwner.requestToken) {
        pendingAsyncLaunchRef.current = null;
        if (!pendingStartCommandRef.current) setTaskLaunchPending(false);
      }
    }
  };

  const handleBookmarkUpdateTitle = async (id: number, title: string) => {
    try {
      await favoritesStorage.updatePromptTitle(id, title);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to update favorite prompt title:', error);
    }
  };

  const handleBookmarkDelete = async (id: number) => {
    try {
      await favoritesStorage.removePrompt(id);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to delete favorite prompt:', error);
    }
  };

  const handleBookmarkReorder = async (draggedId: number, targetId: number) => {
    try {
      // Directly pass IDs to storage function - it now handles the reordering logic
      await favoritesStorage.reorderPrompts(draggedId, targetId);

      // Fetch the updated list from storage to get the new IDs and reflect the authoritative order
      const updatedPromptsFromStorage = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(updatedPromptsFromStorage);
    } catch (error) {
      console.error('Failed to reorder favorite prompts:', error);
    }
  };

  // Load favorite prompts from storage (subscribe + raw chrome.storage so
  // background save_skill always resurfaces skill-run for O1 re-run / e2e).
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);
      } catch (error) {
        console.error('Failed to load favorite prompts:', error);
      }
    };

    void loadFavorites();
    const unsub = favoritesStorage.subscribe(() => void loadFavorites());
    const onChromeStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return;
      if (changes.favorites !== undefined) void loadFavorites();
    };
    try {
      chrome.storage?.onChanged?.addListener(onChromeStorage);
    } catch {
      /* unit tests without chrome */
    }
    return () => {
      unsub();
      try {
        chrome.storage?.onChanged?.removeListener(onChromeStorage);
      } catch {
        /* ignore */
      }
    };
  }, []);

  // After a verified complete, force one favorites pull so "存为 Skill" → skill-run
  // does not depend solely on storage event ordering across extension contexts.
  useEffect(() => {
    if (taskSnapshot?.status !== 'completed') return;
    void favoritesStorage
      .getAllPrompts()
      .then(setFavoritePrompts)
      .catch(() => undefined);
  }, [taskSnapshot?.status, taskSnapshot?.revision]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // Setup connection if not exists
            if (!portRef.current) {
              setupConnection();
            }

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  // Default main surface is idle unless a task is live or the user opened history.
  // Terminal snapshots (completed/failed/cancelled) stay in storage + history only.
  const displayMessages = projectMessagesForDisplay(messages);
  const showMainTaskSurface = shouldShowMainTaskSurface({
    status: taskSnapshot?.status,
    isHistoricalSession,
  });
  const showTaskCard =
    Boolean(taskSnapshot) &&
    (currentSessionId === taskSnapshot?.chatSessionId || taskSnapshot?.sourceSkillId !== undefined);
  // Idle home still shows this session's chat (replies/clarifications); only task card needs active status.
  const showLiveMessages = messages.length > 0;
  const showIdleHint = !showLiveMessages && favoritePrompts.length === 0;
  const liveTaskConsole = Boolean(taskSnapshot) && showTaskCard && isActiveTaskStatus(taskSnapshot.status);
  const hasAuthoritativeLiveTask = protectedLiveHistorySessionId(authoritativeTaskSnapshotRef.current) !== null;
  const visibleFavoritePrompts =
    liveTaskConsole || hasAuthoritativeLiveTask
      ? favoritePrompts.filter(item => item.kind !== 'skill')
      : favoritePrompts;
  const messageRecoveryEnabled = canExposeMessageRecoveryActions({
    isHistoricalSession,
    taskSnapshotLoaded,
    inputEnabled,
  });
  const lifecycleCommandPending = hasPendingLifecycleCommand(pendingCommandTypes);
  // S4: progress console first; chat is a foldable log while the task is live.
  const chatCollapsed = liveTaskConsole && showLiveMessages && !chatLogExpanded;
  // S6: continuous pause/resume stay beside the fixed composer; stop is demoted.
  const showComposerContinuousControls =
    liveTaskConsole &&
    !isHistoricalSession &&
    (taskSnapshot!.status === 'running' ||
      taskSnapshot!.status === 'paused' ||
      taskSnapshot!.status === 'interrupted' ||
      taskSnapshot!.status === 'waiting_user' ||
      taskSnapshot!.status === 'inputs_required');
  const visibleBindPreview =
    taskSnapshot && isActiveTaskStatus(taskSnapshot.status)
      ? taskBoundContentTab(taskSnapshot, bindPreview)
      : bindPreview;

  return (
    <div className="chijie-shell">
      <div className="chijie-shell flex h-screen flex-col overflow-hidden">
        <header className="header relative border-b border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-3">
          <div className="header-logo">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className="min-h-10 cursor-pointer px-2 text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
                aria-label={t('nav_back_a11y')}>
                {t('nav_back')}
              </button>
            ) : (
              <div className="chijie-header-brand">
                <img
                  src={chrome.runtime.getURL('logo-header.png')}
                  alt="scion"
                  className="chijie-header-logo"
                  data-testid="header-logo"
                />
                <span
                  className="chijie-header-brand-sub"
                  data-testid="header-task-status"
                  aria-live="polite"
                  aria-atomic="true">
                  {taskSnapshot && showTaskCard
                    ? taskSnapshot.status === 'completed'
                      ? '任务结果'
                      : t(`chat_task_status_${taskSnapshot.status}` as `chat_task_status_${typeof taskSnapshot.status}`)
                    : t('chat_task_header_idle')}
                </span>
              </div>
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="header-icon cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
                  aria-label={t('nav_newChat_a11y')}
                  aria-busy={Boolean(pendingNewChatCancellationRef.current)}
                  disabled={Boolean(pendingNewChatCancellationRef.current)}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  className="header-icon cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
                  aria-label={t('nav_loadHistory_a11y')}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              className="header-icon cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
              aria-label={t('nav_settings_a11y')}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              protectedSessionId={protectedLiveHistorySessionId(authoritativeTaskSnapshotRef.current)}
              visible={true}
              isDarkMode={false}
            />
          </div>
        ) : (
          <>
            {/* Show loading state while checking model configuration */}
            {hasConfiguredModels === null && (
              <div className="chijie-welcome">
                <div className="text-center">
                  <div
                    className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-[var(--chijie-accent)] border-t-transparent"
                    aria-hidden
                  />
                  <p className="text-[var(--chijie-muted)]">{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {/* First-run: connect one model, then idle (no multi-page onboarding) */}
            {hasConfiguredModels === false && (
              <FirstRunSetup
                onConnected={() => {
                  setHasConfiguredModels(true);
                  void checkModelConfiguration();
                }}
              />
            )}

            {/* Show normal chat interface when models are configured */}
            {hasConfiguredModels === true && (
              <>
                {/*
                  Workspace owns vertical flex: task card is capped summary,
                  chat log is the flexible reading surface, composer stays fixed.
                */}
                <div className="chijie-workspace" data-testid="sidepanel-workspace">
                  {showTaskCard &&
                    taskSnapshot &&
                    (() => {
                      const latestInstruction =
                        [...displayMessages].reverse().find(message => message.actor === Actors.USER)?.content ?? '';
                      const firstUserInstruction = displayMessages.find(
                        message => message.actor === Actors.USER,
                      )?.content;
                      const originalInstruction =
                        displayMessages.find(
                          message =>
                            message.actor === Actors.USER &&
                            'id' in message &&
                            message.id === taskSnapshot.instructionMessageId,
                        )?.content ||
                        firstUserInstruction ||
                        taskSnapshot.plan?.goal ||
                        taskSnapshot.goalSummary ||
                        latestInstruction;
                      const currentRound = taskSnapshot.rounds.find(round => round.id === taskSnapshot.currentRoundId);
                      const canAdjustDirection = taskAllowsDirectionChange(
                        taskSnapshot.status,
                        currentRound?.waitReason,
                      );
                      return (
                        <TaskStatusCard
                          snapshot={taskSnapshot}
                          send={command => {
                            if (!isHistoricalSessionRef.current) sendTaskCommand(command);
                          }}
                          isDarkMode={false}
                          defaultInstruction={latestInstruction}
                          missionInstruction={originalInstruction}
                          evidenceSpace={evidenceSpace}
                          pendingCommandTypes={pendingCommandTypes}
                          readOnly={isHistoricalSession}
                          onContinueInComposer={() => {
                            pendingDirectionChangeRef.current = false;
                            if (taskSnapshot.status === 'completed') setIsFollowUpMode(true);
                            setIsHistoricalSession(false);
                            setInputEnabled(true);
                            window.requestAnimationFrame(() => {
                              const composer = document.querySelector(
                                '.chijie-composer textarea',
                              ) as HTMLTextAreaElement | null;
                              composer?.focus();
                              composer?.scrollIntoView({ block: 'nearest' });
                            });
                          }}
                          onAdjustDirection={
                            canAdjustDirection
                              ? () => {
                                  pendingDirectionChangeRef.current = true;
                                  setIsHistoricalSession(false);
                                  const existingComposer = document.querySelector(
                                    '.chijie-composer textarea',
                                  ) as HTMLTextAreaElement | null;
                                  if (!existingComposer?.value.trim()) {
                                    setInputTextRef.current?.(t('chat_task_adjust_prompt'));
                                  }
                                  setInputEnabled(true);
                                  window.requestAnimationFrame(() => {
                                    const composer = document.querySelector(
                                      '.chijie-composer textarea',
                                    ) as HTMLTextAreaElement | null;
                                    composer?.focus();
                                    composer?.scrollIntoView({ block: 'nearest' });
                                  });
                                }
                              : undefined
                          }
                        />
                      );
                    })()}
                  <div
                    className="chijie-chat-log scrollbar-gutter-stable min-h-0 flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth p-3"
                    data-testid="sidepanel-chat-log"
                    data-collapsed={chatCollapsed ? 'true' : 'false'}
                    data-idle={!showMainTaskSurface ? 'true' : 'false'}>
                    {showLiveMessages ? (
                      chatCollapsed ? (
                        <button
                          type="button"
                          className="chijie-chat-fold"
                          data-testid="chat-log-fold"
                          aria-expanded="false"
                          onClick={() => setChatLogExpanded(true)}>
                          <span>对话 {messages.length} 条</span>
                          <span className="chijie-chat-fold-meta">展开查看委托与追问</span>
                        </button>
                      ) : (
                        <>
                          {liveTaskConsole && (
                            <button
                              type="button"
                              className="chijie-chat-fold"
                              data-testid="chat-log-fold"
                              aria-expanded="true"
                              onClick={() => setChatLogExpanded(false)}>
                              <span>对话 {messages.length} 条</span>
                              <span className="chijie-chat-fold-meta">收起</span>
                            </button>
                          )}
                          <MessageList
                            messages={
                              taskSnapshot?.status === 'running'
                                ? displayMessages
                                : displayMessages.filter(message => message.content !== progressMessage)
                            }
                            isDarkMode={false}
                            onRetry={
                              messageRecoveryEnabled
                                ? () => {
                                    const lastUser = [...messages].reverse().find(m => m.actor === Actors.USER);
                                    if (lastUser?.content) {
                                      void handleSendMessage(lastUser.content);
                                    } else {
                                      setInputTextRef.current?.('');
                                    }
                                  }
                                : undefined
                            }
                            onRephrase={
                              messageRecoveryEnabled
                                ? () => {
                                    const el = document.querySelector(
                                      '.chijie-composer textarea',
                                    ) as HTMLTextAreaElement | null;
                                    el?.focus();
                                  }
                                : undefined
                            }
                          />
                          <div ref={messagesEndRef} />
                        </>
                      )
                    ) : showIdleHint ? (
                      <div
                        className="flex h-full min-h-[8.5rem] items-center justify-center px-2"
                        data-testid="empty-composer-spacer">
                        <p className="text-center text-xs text-[var(--chijie-muted)]" data-testid="idle-delegate-hint">
                          {t('chat_empty_hint')}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  {/* Skills must stay runnable after a completed chat (O1 skill re-run / e2e).
                      Plain prompt bookmarks still prefer the empty-composer surface.
                      On idle home, prior live messages are hidden so skills still surface. */}
                  {visibleFavoritePrompts.length > 0 &&
                    (!showLiveMessages || visibleFavoritePrompts.some(item => item.kind === 'skill')) && (
                      <div
                        className="chijie-bookmarks max-h-36 shrink-0 overflow-y-auto"
                        data-testid="bookmark-list-panel">
                        <BookmarkList
                          bookmarks={visibleFavoritePrompts}
                          onBookmarkSelect={handleBookmarkSelect}
                          onSkillRun={handleSkillRun}
                          onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                          onBookmarkDelete={handleBookmarkDelete}
                          onBookmarkReorder={handleBookmarkReorder}
                          skillRunDisabled={taskLaunchPending}
                          isDarkMode={false}
                        />
                      </div>
                    )}
                </div>
                <div
                  className="chijie-composer"
                  data-task-active={liveTaskConsole || showStopButton ? 'true' : 'false'}>
                  <div
                    className="chijie-bind-chip"
                    data-testid="active-tab-bind"
                    data-bound={visibleBindPreview ? 'true' : 'false'}
                    title={formatBindDetail(visibleBindPreview) || t('chat_task_bind_missing')}
                    role="status"
                    aria-live="polite">
                    <span className="chijie-bind-chip-kicker">{t('chat_task_bind_kicker')}</span>
                    <span className="chijie-bind-chip-value">
                      {formatBindChip(visibleBindPreview, t('chat_task_bind_missing'))}
                    </span>
                  </div>
                  {showComposerContinuousControls && taskSnapshot && (
                    <div
                      className="chijie-composer-controls"
                      data-testid="composer-continuous-controls"
                      data-status={taskSnapshot.status}>
                      {taskSnapshot.status === 'running' ? (
                        <button
                          type="button"
                          className="chijie-btn-secondary"
                          data-testid="composer-pause"
                          disabled={lifecycleCommandPending}
                          aria-busy={lifecycleCommandPending}
                          onClick={handlePauseTask}>
                          {t('chat_task_pause')}
                        </button>
                      ) : taskSnapshot.status === 'paused' || taskSnapshot.status === 'interrupted' ? (
                        <button
                          type="button"
                          className="chijie-btn-primary"
                          data-testid="composer-resume"
                          disabled={lifecycleCommandPending}
                          aria-busy={lifecycleCommandPending}
                          onClick={handleResumeTask}>
                          {t('chat_task_resume')}
                        </button>
                      ) : null}
                      {taskNeedsDirectStop(taskSnapshot.status) ? (
                        <button
                          type="button"
                          className="chijie-btn-secondary"
                          data-testid="composer-stop"
                          disabled={lifecycleCommandPending}
                          aria-busy={lifecycleCommandPending}
                          onClick={() => void handleStopTask()}>
                          {t('chat_task_stop')}
                        </button>
                      ) : (
                        <div className="chijie-composer-stop">
                          <details>
                            <summary aria-label="更多任务操作">更多</summary>
                            <div className="chijie-composer-stop-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                data-testid="composer-stop"
                                disabled={lifecycleCommandPending}
                                aria-busy={lifecycleCommandPending}
                                onClick={() => void handleStopTask()}>
                                {t('chat_task_stop')}
                              </button>
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  )}
                  <ChatInput
                    onSendMessage={handleSendMessage}
                    onStopTask={handleStopTask}
                    onMicClick={handleMicClick}
                    isRecording={isRecording}
                    isProcessingSpeech={isProcessingSpeech}
                    disabled={!taskSnapshotLoaded || !inputEnabled || isHistoricalSession}
                    showStopButton={false}
                    setContent={setter => {
                      setInputTextRef.current = setter;
                    }}
                    isDarkMode={false}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
