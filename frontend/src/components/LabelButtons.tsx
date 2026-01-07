/**
 * Label selection buttons component.
 */

import type { LabelType } from '../types';
import { LABEL_NAMES, LABEL_COLORS } from '../types';

interface LabelButtonsProps {
  onLabel: (label: LabelType) => void;
  disabled?: boolean;
}

export function LabelButtons({ onLabel, disabled }: LabelButtonsProps) {
  const labels: LabelType[] = [0, 1, 2];

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Select Label (or press 1/2/3)</h3>
      <div style={styles.buttonsContainer}>
        {labels.map((label) => (
          <button
            key={label}
            onClick={() => onLabel(label)}
            disabled={disabled}
            style={{
              ...styles.button,
              backgroundColor: LABEL_COLORS[label],
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <span style={styles.buttonLabel}>{label + 1}</span>
            <span style={styles.buttonName}>{LABEL_NAMES[label]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
  },
  title: {
    margin: '0 0 15px 0',
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
  },
  buttonsContainer: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'center',
  },
  button: {
    flex: 1,
    padding: '15px 20px',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    transition: 'transform 0.1s, box-shadow 0.1s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,
  buttonLabel: {
    display: 'block',
    fontSize: '24px',
    marginBottom: '5px',
  },
  buttonName: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
  },
};
