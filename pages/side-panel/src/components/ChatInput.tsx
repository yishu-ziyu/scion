import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { FiArrowUp, FiPaperclip, FiPlus, FiSquare, FiX } from 'react-icons/fi';
import { t } from '@extension/i18n';
import {
  CURRENT_PAGE_TOKEN,
  expandCurrentPageMention,
  insertCurrentPageMention,
  mentionMatchesCurrentPage,
  mentionTriggerAt,
  type MentionPage,
} from '../presentation/composer-mention';
import { dropdownClassName, useDismissPhase } from '../presentation/motion-open';

export type SendMessageResult = { delivered: true } | { delivered: false; feedback?: string };
export type SendMessageOptions = { retry?: boolean };

/** Keep ordinary instructions literal; only an explicit @当前页 token adds page context. */
export function messageContentForChatInput(text: string, currentPage: MentionPage | null): string {
  return expandCurrentPageMention(text, currentPage);
}

export function shouldClearComposerAfterDelivery(result: SendMessageResult): result is { delivered: true } {
  return result.delivered;
}

interface ChatInputProps {
  onSendMessage: (
    text: string,
    displayText?: string,
    options?: SendMessageOptions,
  ) => SendMessageResult | Promise<SendMessageResult>;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  live?: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  currentPage?: MentionPage | null;
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

export function closeAttachmentMenuOnEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  closeMenu: () => void,
  restoreTriggerFocus: () => void,
): boolean {
  if (event.key !== 'Escape') return false;
  event.preventDefault();
  closeMenu();
  restoreTriggerFocus();
  return true;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  live = false,
  setContent,
  currentPage = null,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [deliveryFeedback, setDeliveryFeedback] = useState<string | null>(null);
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0),
    [disabled, text, attachedFiles],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const attachmentPhase = useDismissPhase(attachmentMenuOpen);
  const mentionPhase = useDismissPhase(mentionOpen);

  // Handle text changes and resize textarea
  const syncMentionMenu = useCallback((value: string, cursor: number) => {
    const trigger = mentionTriggerAt(value, cursor);
    setMentionOpen(Boolean(trigger && mentionMatchesCurrentPage(trigger.query)));
  }, []);

  const applyCurrentPageMention = useCallback(() => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const trigger = mentionTriggerAt(text, cursor);
    const next = trigger
      ? insertCurrentPageMention(text, trigger.start, cursor)
      : insertCurrentPageMention(`${text.slice(0, cursor)}@${text.slice(cursor)}`, cursor, cursor + 1);
    setText(next);
    setMentionOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [text]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    setDeliveryFeedback(null);
    syncMentionMenu(newText, e.target.selectionStart ?? newText.length);

    // Resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Initial resize when component mounts
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
    }
  }, []);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      closeAttachmentMenuOnEscape(
        event,
        () => setAttachmentMenuOpen(false),
        () => attachmentTriggerRef.current?.focus(),
      );
    };
    const doc = attachmentMenuRef.current?.ownerDocument ?? document;
    doc.addEventListener('pointerdown', closeOnOutsidePointer);
    doc.addEventListener('keydown', closeOnEscape);
    return () => {
      doc.removeEventListener('pointerdown', closeOnOutsidePointer);
      doc.removeEventListener('keydown', closeOnEscape);
    };
  }, [attachmentMenuOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0) {
        let messageContent = messageContentForChatInput(trimmedText, currentPage);
        let displayContent = trimmedText;

        // Security: Clearly separate user input from file content
        // The background service will sanitize file content using guardrails
        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => {
              // Tag file content for background service to identify and sanitize
              return `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`;
            })
            .join('\n');

          // Combine user message with tagged file content (for background service)
          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          // Create display version with only filenames (for UI)
          const fileList = attachedFiles.map(file => `附件：${file.name}`).join('\n');
          displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
        }

        const result = await onSendMessage(messageContent, displayContent);
        if (!shouldClearComposerAfterDelivery(result)) {
          setDeliveryFeedback(result.feedback ?? '指令没有发送。输入已保留，请稍后再试。');
          return;
        }
        setDeliveryFeedback(null);
        setText('');
        setAttachedFiles([]);
      }
    },
    [text, attachedFiles, currentPage, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionOpen && (e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        applyCurrentPageMention();
        return;
      }
      if (e.key === 'Escape' && mentionOpen) {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [applyCurrentPageMention, handleSubmit, mentionOpen],
  );

  const handleFileSelect = useCallback(() => {
    setAttachmentMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: AttachedFile[] = [];
    const allowedTypes = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();

      // Check if file type is allowed
      if (!allowedTypes.includes(fileExt)) {
        console.warn(`File type ${fileExt} not supported. Only text-based files are allowed.`);
        continue;
      }

      // Check file size (limit to 1MB)
      if (file.size > 1024 * 1024) {
        console.warn(`File ${file.name} is too large. Maximum size is 1MB.`);
        continue;
      }

      try {
        const content = await file.text();
        newFiles.push({
          name: file.name,
          content,
          type: file.type || 'text/plain',
        });
      } catch (error) {
        console.error(`Error reading file ${file.name}:`, error);
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="task-mode-input"
      className={`chijie-prompt-input${disabled ? ' is-disabled' : ''}`}
      aria-label={t('chat_input_form')}>
      <div className="chijie-prompt-frame">
        {attachedFiles.length > 0 && (
          <div className="chijie-prompt-chips" data-testid="prompt-attachments">
            {attachedFiles.map((file, index) => (
              <span key={`${file.name}-${index}`} className="chijie-prompt-chip">
                <FiPaperclip aria-hidden />
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className="chijie-prompt-chip-remove"
                  aria-label={`Remove ${file.name}`}>
                  <FiX aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          data-testid="goal-input"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          rows={2}
          className="chijie-prompt-field"
          placeholder={
            attachedFiles.length > 0
              ? t('chat_task_input_attach_placeholder')
              : showStopButton || live
                ? t('chat_task_input_continue')
                : t('chat_task_input_placeholder')
          }
          aria-label={t('chat_input_editor')}
        />

        {mentionPhase.mounted && (
          <div
            className={`chijie-prompt-menu chijie-mention-menu ${dropdownClassName(mentionPhase)}`}
            data-origin="bottom-left"
            role="listbox"
            data-testid="composer-mention-menu">
            {currentPage ? (
              <button
                type="button"
                role="option"
                aria-selected="true"
                data-testid="composer-mention-current-page"
                onClick={applyCurrentPageMention}>
                <span>{CURRENT_PAGE_TOKEN}</span>
                <small>
                  {currentPage.host} · {currentPage.title}
                </small>
              </button>
            ) : (
              <p data-testid="composer-mention-empty">{t('chat_task_bind_missing')}</p>
            )}
          </div>
        )}

        <div className="chijie-prompt-actions">
          <div className="chijie-prompt-actions-left">
            <div className="chijie-prompt-add-wrap" ref={attachmentMenuRef}>
              <button
                ref={attachmentTriggerRef}
                type="button"
                className="chijie-prompt-icon-button chijie-prompt-add"
                data-open={attachmentMenuOpen ? 'true' : undefined}
                onClick={() => setAttachmentMenuOpen(open => !open)}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={attachmentMenuOpen}
                aria-label={t('chat_input_attach_files')}>
                <FiPlus aria-hidden />
              </button>
              {attachmentPhase.mounted && (
                <div
                  className={`chijie-prompt-menu ${dropdownClassName(attachmentPhase)}`}
                  data-origin="bottom-left"
                  role="menu">
                  <button type="button" role="menuitem" onClick={handleFileSelect}>
                    <FiPaperclip aria-hidden />
                    <span>{t('chat_input_attach_files')}</span>
                  </button>
                  <small>.txt · .md · .json · .csv · 1 MB</small>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />
            <button
              type="button"
              className="chijie-prompt-icon-button"
              data-testid="composer-mention-button"
              disabled={disabled}
              aria-label={CURRENT_PAGE_TOKEN}
              onClick={() => {
                if (currentPage) applyCurrentPageMention();
                else setMentionOpen(true);
              }}>
              @
            </button>
            {onMicClick && (
              <button
                type="button"
                onClick={onMicClick}
                disabled={disabled || isProcessingSpeech}
                aria-label={
                  isProcessingSpeech
                    ? t('chat_stt_processing')
                    : isRecording
                      ? t('chat_stt_recording_stop')
                      : t('chat_stt_input_start')
                }
                className={`chijie-prompt-icon-button chijie-prompt-mic${isRecording ? ' is-recording' : ''}`}>
                {isProcessingSpeech ? (
                  <AiOutlineLoading3Quarters className="chijie-prompt-spinner" aria-hidden />
                ) : (
                  <FaMicrophone aria-hidden />
                )}
              </button>
            )}
            <span data-testid="task-mode-badge" className="chijie-prompt-mode chijie-visually-hidden">
              {t('chat_task_mode_badge')}
            </span>
          </div>

          <div className="chijie-prompt-actions-right">
            <div className="t-icon-swap" data-state={showStopButton ? 'b' : 'a'}>
              <span className="t-icon" data-icon="a">
                <button
                  type="submit"
                  data-testid="goal-send"
                  disabled={isSendButtonDisabled || showStopButton}
                  aria-disabled={isSendButtonDisabled || showStopButton}
                  className="chijie-prompt-icon-button chijie-prompt-send"
                  aria-label={t('chat_buttons_send')}>
                  <FiArrowUp aria-hidden />
                </button>
              </span>
              <span className="t-icon" data-icon="b">
                <button
                  type="button"
                  onClick={onStopTask}
                  className="chijie-prompt-icon-button chijie-prompt-stop"
                  aria-label={t('chat_buttons_stop')}
                  tabIndex={showStopButton ? 0 : -1}>
                  <FiSquare aria-hidden />
                </button>
              </span>
            </div>
          </div>
        </div>
        {deliveryFeedback ? (
          <div className="t-input-wrap is-error" data-testid="goal-send-feedback-wrap">
            <p
              key={deliveryFeedback}
              role="alert"
              data-testid="goal-send-feedback"
              className="chijie-prompt-feedback t-toast is-open t-error-msg t-input is-error is-shaking">
              {deliveryFeedback}
            </p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
