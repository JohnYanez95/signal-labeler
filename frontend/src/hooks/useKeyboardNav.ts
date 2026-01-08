/**
 * Custom hook for keyboard navigation and labeling shortcuts.
 */

import { useEffect } from 'react';
import type { LabelType } from '../types';

interface UseKeyboardNavProps {
  onPrevious: () => void;
  onNext: () => void;
  onLabel: (label: LabelType) => void;
  enabled: boolean;
}

export function useKeyboardNav({ onPrevious, onNext, onLabel, enabled }: UseKeyboardNavProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'j':
        case 'J':
          event.preventDefault();
          onPrevious();
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          event.preventDefault();
          onNext();
          break;
        case '1':
          event.preventDefault();
          onLabel(0);  // 1 -> Class A (label 0)
          break;
        case '2':
          event.preventDefault();
          onLabel(1);  // 2 -> Class B (label 1)
          break;
        case '3':
          event.preventDefault();
          onLabel(2);  // 3 -> Invalid (label 2)
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onPrevious, onNext, onLabel]);
}
