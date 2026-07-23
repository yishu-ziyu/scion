import type { DevLocale, MessageKey } from './type';
import zh_CNMessage from '../locales/zh_CN/messages.json';

/**
 * Product UI is locked to Simplified Chinese (持节).
 * Browser/UI language must not switch chrome.i18n to English for this graft.
 */
const PRODUCT_LOCALE = 'zh_CN' as const;

type I18nValue = {
  message: string;
  placeholders?: Record<string, { content?: string; example?: string }>;
};

function translate(key: MessageKey, substitutions?: string | string[]) {
  const value = (zh_CNMessage as Record<string, I18nValue>)[key];
  if (!value?.message) {
    return chrome.i18n.getMessage(key, substitutions) || String(key);
  }

  let message = value.message;
  if (value.placeholders) {
    Object.entries(value.placeholders).forEach(([placeholderKey, { content }]) => {
      if (!content) return;
      message = message.replace(new RegExp(`\\$${placeholderKey}\\$`, 'gi'), content);
    });
  }

  if (!substitutions) {
    return message;
  }
  if (Array.isArray(substitutions)) {
    return substitutions.reduce((acc, cur, idx) => acc.replace(`$${idx + 1}`, cur), message);
  }
  return message.replace(/\$(\d+)/, substitutions);
}

function removePlaceholder(message: string) {
  return message.replace(/\$\d+/g, '');
}

export function t(...args: Parameters<typeof translate>) {
  return removePlaceholder(translate(...args));
}

t.devLocale = PRODUCT_LOCALE as DevLocale;
