import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { FiArrowUp, FiPaperclip, FiPlus, FiSquare, FiX } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0),
    [disabled, text, attachedFiles],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

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
      if (event.key === 'Escape') setAttachmentMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [attachmentMenuOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0) {
        let messageContent = trimmedText;
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

        onSendMessage(messageContent, displayContent);
        setText('');
        setAttachedFiles([]);
      }
    },
    [text, attachedFiles, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
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
            attachedFiles.length > 0 ? t('chat_task_input_attach_placeholder') : t('chat_task_input_placeholder')
          }
          aria-label={t('chat_input_editor')}
        />

        <div className="chijie-prompt-actions">
          <div className="chijie-prompt-actions-left">
            <div className="chijie-prompt-add-wrap" ref={attachmentMenuRef}>
              <button
                type="button"
                className="chijie-prompt-icon-button chijie-prompt-add"
                data-open={attachmentMenuOpen ? 'true' : undefined}
                onClick={() => setAttachmentMenuOpen(open => !open)}
                disabled={disabled}
                aria-expanded={attachmentMenuOpen}
                aria-label={t('chat_input_attach_files')}>
                <FiPlus aria-hidden />
              </button>
              {attachmentMenuOpen && (
                <div className="chijie-prompt-menu" role="menu">
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
            <span data-testid="task-mode-badge" className="chijie-prompt-mode">
              {t('chat_task_mode_badge')}
            </span>
          </div>

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="chijie-prompt-icon-button chijie-prompt-stop"
              aria-label={t('chat_buttons_stop')}>
              <FiSquare aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              data-testid="goal-send"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className="chijie-prompt-icon-button chijie-prompt-send"
              aria-label={t('chat_buttons_send')}>
              <FiArrowUp aria-hidden />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
