import 'webextension-polyfill';
import { llmProviderStore, analyticsSettingsStore } from '@extension/storage';
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
import { chromeTabsSendMessage, syncPageOperatingBar } from './task/page-operating';
import { browserContext, createExecutorDriver } from './agent/factory';

const logger = createLogger('background');

const sidePanelPorts = new PortRegistry<chrome.runtime.Port>();
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const taskManager = new TaskManager({
  createExecutor: (input, hooks) =>
    createExecutorDriver(input, hooks, event => sidePanelPorts.broadcast(port => port.postMessage(event))),
  switchTab: async tabId => {
    await browserContext.switchTab(tabId);
  },
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

taskManager.subscribe(event => {
  sidePanelPorts.broadcast(port => port.postMessage({ type: 'task_event', event }));
  void taskManager
    .activeSnapshot()
    .then(snapshot =>
      syncPageOperatingBar(snapshot, (tabId, message) => chromeTabsSendMessage(tabId, message)),
    )
    .catch(error => logger.error('Page operating bar sync failed', error));
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

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      void taskManager.interruptActive();
      await browserContext.cleanup();
    }
  }
});

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

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener(() => {
  // Handle other message types if needed in the future
  // Return false if response is not sent asynchronously
  // return false;
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

          case 'task_command':
            return port.postMessage({ type: 'command_ack', ack: await taskManager.dispatch(message.command) });

          case 'get_active_task':
            return port.postMessage({ type: 'task_snapshot', snapshot: await taskManager.activeSnapshot() });

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
      if (!sidePanelPorts.release(port)) return;
      void taskManager.interruptActive();
    });
  }
});
