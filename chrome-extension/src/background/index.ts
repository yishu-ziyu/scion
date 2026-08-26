import 'webextension-polyfill';
import { llmProviderStore, analyticsSettingsStore, firewallStore } from '@extension/storage';
import { removeLegacyAgentStepHistories } from '@extension/storage/lib/chat';
import { t } from '@extension/i18n';
import { createLogger } from './log';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { ensurePersonalDefaults } from '../personal/bootstrap';
import { TaskManager } from './task/manager';
import { PortRegistry } from './task/port-registry';
import {
  chromeTabsSendMessage,
  PAGE_OPERATING_FOLLOW,
  PAGE_OPERATING_STOP,
  PAGE_OPERATING_TAKEOVER,
  pageOperatingCancelCommand,
  pageOperatingFollowCommand,
  pageOperatingTakeoverCommand,
  createPageOperatingBarSyncQueue,
} from './task/page-operating';
import { browserContext, createExecutorDriver } from './agent/factory';
import { handleChatStreamRequest } from './chat-stream';

import { createDebuggerDetachHandler } from './runtime/debugger-detach';
import { STRUCTURE_USER_MEMORY_TYPE, structureUserMemoryFromSource } from './agent/structure-user-memory';

const logger = createLogger('background');

const sidePanelPorts = new PortRegistry<chrome.runtime.Port>();
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const taskManager = new TaskManager({
  createExecutor: (input, hooks) =>
    createExecutorDriver(input, hooks, event => sidePanelPorts.broadcast(port => port.postMessage(event))),
  switchTab: async tabId => {
    await browserContext.bindToTab(tabId);
  },
  setFollowForeground: follow => {
    browserContext.setRevealForeground(follow);
  },
  revealTab: async tabId => {
    await browserContext.revealTab(tabId);
  },
  beginTaskTabGroup: async (title, existingGroupId, resetTaskOwnership) => {
    return browserContext.beginTaskTabGroup(title, existingGroupId, resetTaskOwnership);
  },
  registerTaskOwnedTab: tabId => browserContext.registerTaskOwnedTab(tabId),
  cleanupBrowserContext: () => browserContext.cleanup(),
  isTaskOwnedTab: tabId => browserContext.isTaskOwnedTab(tabId),
  authorizeUnownedTabClose: tabId => browserContext.authorizeUnownedTabClose(tabId),
  observeCriteria: async criteria => {
    const page = await browserContext.getCurrentPage();
    return page.observeCompletionCriteria(criteria);
  },
  probeTabState: async tabId => {
    try {
      const tab = await chrome.tabs.get(tabId);
      return tab.active ? 'active' : 'inactive';
    } catch {
      return 'closed';
    }
  },
  openBlankTaskTab: async () => {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    if (!tab.id) throw new Error('No tab ID available');
    return tab.id;
  },

  probeDownloadState: async () => {
    if (typeof chrome === 'undefined' || !chrome.downloads?.search) return 'none';
    return new Promise(resolve => {
      try {
        chrome.downloads.search({ orderBy: ['-startTime'], limit: 8 }, items => {
          if (chrome.runtime.lastError || !items?.length) {
            resolve('none');
            return;
          }
          const recent = items.filter(item => {
            const started = Date.parse(item.startTime || '');
            return Number.isFinite(started) && Date.now() - started < 120_000;
          });
          if (recent.some(item => item.state === 'complete')) {
            resolve('finished');
            return;
          }
          if (recent.some(item => item.state === 'in_progress')) {
            resolve('started');
            return;
          }
          resolve('none');
        });
      } catch {
        resolve('none');
      }
    });
  },
  now: () => Date.now(),
});

const syncLatestPageOperatingBar = createPageOperatingBarSyncQueue(
  () => taskManager.activeSnapshot(),
  (tabId, message) => chromeTabsSendMessage(tabId, message),
  error => logger.error('Page operating bar sync failed', error),
);

taskManager.subscribe(event => {
  sidePanelPorts.broadcast(port => port.postMessage({ type: 'task_event', event }));
  void syncLatestPageOperatingBar();
});

// Personal fork: seed MiniMax-M3 into chrome.storage on every SW boot (no GUI).
void ensurePersonalDefaults().catch(error => logger.error('Personal bootstrap failed', error));
void removeLegacyAgentStepHistories().catch(error => logger.error('Legacy replay cleanup failed', error));
void taskManager.recover().catch(error => logger.error('Task recovery failed', error));
chrome.runtime.onInstalled.addListener(() => {
  void ensurePersonalDefaults().catch(error => logger.error('Personal bootstrap onInstalled failed', error));
});
chrome.runtime.onStartup.addListener(() => {
  void ensurePersonalDefaults().catch(error => logger.error('Personal bootstrap onStartup failed', error));
});

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    await browserContext.handleTabUpdated(tab);
  } catch (error) {
    logger.error('Failed to invalidate updated tab', error);
  }
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
  }
});

// Chrome does not await event-listener promises, so keep debugger cancellation
// cleanup behind an explicit error boundary.
chrome.debugger.onDetach.addListener(
  createDebuggerDetachHandler({
    interruptActive: () => taskManager.interruptActive(),
    isCurrentTaskTab: tabId => browserContext.getBoundTabId() === tabId,
    onError: (message, error) => logger.error(message, error),
  }),
);

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Keep the browser-context URL firewall in sync with stored settings from
// boot onward, so tab binding honors the user's firewall before an executor
// starts (not only after the first executor launch).
firewallStore.subscribe(() => {
  void firewallStore
    .getFirewall()
    .then(firewall => {
      browserContext.updateConfig({
        allowedUrls: firewall.enabled ? firewall.allowList : [],
        deniedUrls: firewall.enabled ? firewall.denyList : [],
      });
    })
    .catch(error => logger.error('Failed to apply firewall settings', error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== STRUCTURE_USER_MEMORY_TYPE) return false;
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }
  void structureUserMemoryFromSource(typeof message.sourceText === 'string' ? message.sourceText : '')
    .then(result => sendResponse(result))
    .catch(error => {
      logger.error('structure_user_memory failed', error);
      sendResponse({ ok: false, error: 'llm_failed' });
    });
  return true;
});

// Page overlay: 跟随 / 接管 / legacy stop. Only from the tab this task is driving.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    (message.type !== PAGE_OPERATING_STOP &&
      message.type !== PAGE_OPERATING_TAKEOVER &&
      message.type !== PAGE_OPERATING_FOLLOW)
  ) {
    return false;
  }
  void taskManager
    .activeSnapshot()
    .then(async snapshot => {
      const commandId = crypto.randomUUID();
      const command =
        message.type === PAGE_OPERATING_FOLLOW
          ? pageOperatingFollowCommand(snapshot, sender.tab?.id, commandId, Boolean(message.follow))
          : (pageOperatingTakeoverCommand(snapshot, sender.tab?.id, commandId) ??
            (message.type === PAGE_OPERATING_STOP
              ? pageOperatingCancelCommand(snapshot, sender.tab?.id, commandId)
              : null));
      if (command) await taskManager.dispatch(command);
      sendResponse({ ok: Boolean(command) });
    })
    .catch(error => {
      logger.error('Page operating control failed', error);
      sendResponse({ ok: false });
    });
  return true;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    sidePanelPorts.add(port);

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'chat_stream':
            return handleChatStreamRequest(message, port);

          case 'task_command':
            return port.postMessage({ type: 'command_ack', ack: await taskManager.dispatch(message.command) });

          case 'get_active_task':
            return port.postMessage({ type: 'task_snapshot', snapshot: await taskManager.activeSnapshot() });

          case 'get_task': {
            const taskId = typeof message.taskId === 'string' ? message.taskId : '';
            return port.postMessage({
              type: 'task_snapshot',
              requestedTaskId: taskId,
              snapshot: taskId ? await taskManager.snapshot(taskId) : null,
            });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('Side panel disconnected');
      // The side panel is a control/observation surface, not the task's lifetime owner.
      // Chrome can replace this port during panel refreshes, tab focus changes, extension
      // reloads, or transient renderer suspension. Treating the last disconnect as an
      // interruption makes ordinary read-only tasks stop and ask the user to continue.
      // Explicit Pause/Stop commands and debugger cancellation remain authoritative.
      sidePanelPorts.release(port);
    });
  }
});
