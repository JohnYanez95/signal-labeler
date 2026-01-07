/**
 * Status indicator showing label status for current run.
 * Shows user's label color when labeled, hides other labels to avoid bias.
 */

import type { LabelStatus, LabelType } from '../types';
import { LABEL_NAMES } from '../types';

interface StatusIndicatorProps {
  status: LabelStatus;
  userLabel?: LabelType | null;  // The label the current user submitted for this run
}

// Background colors for each label type (lighter versions for better contrast)
const LABEL_BG_COLORS: Record<LabelType, string> = {
  0: '#fee2e2',  // Light red for class_a
  1: '#dbeafe',  // Light blue for class_b
  2: '#fef3c7',  // Light yellow for invalid
};

// Text colors for each label type
const LABEL_TEXT_COLORS: Record<LabelType, string> = {
  0: '#991b1b',  // Dark red
  1: '#1e40af',  // Dark blue
  2: '#92400e',  // Dark amber
};

export function StatusIndicator({ status, userLabel }: StatusIndicatorProps) {
  if (!status.is_labeled) {
    return (
      <div style={{ ...styles.container, ...styles.unlabeled }}>
        <span style={styles.badge}>●</span>
        <span style={styles.text}>Unlabeled</span>
      </div>
    );
  }

  // Determine styling based on user's label
  const hasUserLabel = userLabel !== null && userLabel !== undefined;
  const containerStyle = hasUserLabel
    ? {
        ...styles.container,
        backgroundColor: LABEL_BG_COLORS[userLabel],
        color: LABEL_TEXT_COLORS[userLabel],
      }
    : { ...styles.container, ...styles.labeled };

  return (
    <div style={containerStyle}>
      <span style={styles.badge}>✓</span>
      <span style={styles.text}>
        {hasUserLabel ? LABEL_NAMES[userLabel] : 'Labeled'} ({status.n_votes} vote{status.n_votes !== 1 ? 's' : ''})
      </span>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 15px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
  },
  unlabeled: {
    backgroundColor: '#d1fae5',
    color: '#065f46',
  },
  labeled: {
    backgroundColor: '#e5e7eb',
    color: '#374151',
  },
  badge: {
    fontSize: '16px',
  },
  text: {
    fontWeight: '600',
  },
};
