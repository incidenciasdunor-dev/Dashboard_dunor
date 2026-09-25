import { useEffect, useRef } from 'react';

/**
 * Global Mobile Back Navigation Manager
 * Handles physical and virtual back button on mobile devices (browser popstate event).
 * Allows modals, print views, forms, and dialogs across the entire application
 * to intercept the back action and return to the previous screen cleanly.
 */

type BackHandler = () => boolean | void;

interface RegisteredHandler {
  id: string;
  onBack: BackHandler;
}

const handlerStack: RegisteredHandler[] = [];
let isPopstateTriggered = false;
let isProgrammaticBack = false;
let modalHistoryDepth = 0;

/**
 * Register a back handler and push a dummy history state so the mobile
 * back button will trigger popstate instead of exiting the page.
 */
export const pushBackHandler = (id: string, onBack: BackHandler): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  try {
    window.history.pushState({ dunorModal: true, handlerId: id, timestamp: Date.now() }, '');
    modalHistoryDepth++;
  } catch (e) {
    // Ignore history error
  }

  // Remove existing with same id if already present
  const existingIdx = handlerStack.findIndex(h => h.id === id);
  if (existingIdx !== -1) {
    handlerStack.splice(existingIdx, 1);
  }

  handlerStack.push({ id, onBack });

  return () => {
    popBackHandler(id);
  };
};

/**
 * Unregister a back handler. If closed via on-screen UI (X, Cancel, backdrop),
 * cleanly revert the browser history state so back button doesn't retain a dead forward state.
 */
export const popBackHandler = (id: string) => {
  if (typeof window === 'undefined') return;

  const idx = handlerStack.findIndex(h => h.id === id);
  if (idx !== -1) {
    handlerStack.splice(idx, 1);

    // If the close was NOT triggered by mobile back button popstate
    if (!isPopstateTriggered) {
      if (modalHistoryDepth > 0) {
        modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
        try {
          isProgrammaticBack = true;
          window.history.back();
        } catch (e) {
          isProgrammaticBack = false;
        }
      }
    }
  }
};

/**
 * Handle browser popstate event.
 * Returns true if a modal, form, or view consumed the back action.
 */
export const handleGlobalPopstate = (): boolean => {
  if (typeof window === 'undefined') return false;

  if (isProgrammaticBack) {
    isProgrammaticBack = false;
    return true;
  }

  if (handlerStack.length > 0) {
    modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
    isPopstateTriggered = true;
    try {
      const topHandler = handlerStack.pop();
      if (topHandler) {
        topHandler.onBack();
        return true;
      }
    } finally {
      setTimeout(() => {
        isPopstateTriggered = false;
      }, 200);
    }
  }

  return false;
};

export const hasActiveBackHandlers = (): boolean => handlerStack.length > 0;

/**
 * React hook to bind any modal, window, form, or print view to the mobile back button.
 * When `isOpen` is true, pressing Back on mobile will automatically invoke `onClose()`.
 */
export const useBackHandler = (isOpen: boolean, onClose: () => void, id: string) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const unregister = pushBackHandler(id, () => {
      onCloseRef.current();
    });

    return () => {
      unregister();
    };
  }, [isOpen, id]);
};
