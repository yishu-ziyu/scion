import { useCallback, useEffect, useRef, useState } from 'react';
import { PiPictureInPictureBold } from 'react-icons/pi';
import { t } from '@extension/i18n';
import {
  APP_CONTAINER_ID,
  createChatPipController,
  getDocumentPip,
  type ChatPipController,
} from '../presentation/document-pip';
import { HeaderTip } from './MotionPrimitives';

function pipSupported(): boolean {
  return typeof window !== 'undefined' && getDocumentPip(window) !== null;
}

export function PictureInPictureButton() {
  const controllerRef = useRef<ChatPipController | null>(null);
  const [open, setOpen] = useState(false);
  const supported = pipSupported();

  useEffect(() => {
    const controller = createChatPipController(window, {
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
    });
    controllerRef.current = controller;
    return () => {
      controller.close();
      controllerRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller?.supported) return;
    if (controller.isOpen()) {
      controller.close();
      return;
    }
    const node = document.getElementById(APP_CONTAINER_ID);
    const home = node?.parentNode;
    if (!node || !home) return;
    void controller.open({ node, home, parkedText: t('chat_pip_parked') });
  }, []);

  const label = open
    ? t('nav_pictureInPicture_close_a11y')
    : supported
      ? t('nav_pictureInPicture_open_a11y')
      : t('chat_pip_unsupported');

  return (
    <HeaderTip label={label}>
      <button
        type="button"
        className="header-icon t-tt-trigger cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
        data-testid="header-picture-in-picture"
        data-active={open ? 'true' : undefined}
        aria-pressed={open}
        aria-label={label}
        disabled={!supported}
        onClick={toggle}>
        <PiPictureInPictureBold size={20} />
      </button>
    </HeaderTip>
  );
}
