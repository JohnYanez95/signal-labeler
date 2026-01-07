/**
 * Run navigation component with progress indicator and search/pagination.
 */

import { useState, useRef, useEffect } from 'react';

interface RunNavigatorProps {
  currentIndex: number;
  totalRuns: number;
  runId: string;
  deviceId: string;
  onPrevious: () => void;
  onNext: () => void;
  onGoToIndex: (index: number) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  labeledRunIds?: Set<string>;
  runs?: { run_id: string }[];
}

export function RunNavigator({
  currentIndex,
  totalRuns,
  runId,
  deviceId,
  onPrevious,
  onNext,
  onGoToIndex,
  hasPrevious,
  hasNext,
  labeledRunIds = new Set(),
  runs = [],
}: RunNavigatorProps) {
  const [searchValue, setSearchValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    setShowDropdown(true);
  };

  const handleGoToRun = (index: number) => {
    onGoToIndex(index);
    setSearchValue('');
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const num = parseInt(searchValue);
      if (num >= 1 && num <= totalRuns) {
        handleGoToRun(num - 1);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSearchValue('');
    }
  };

  // Filter runs based on search
  const getFilteredRuns = () => {
    const results: { index: number; runId: string; labeled: boolean }[] = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const runNum = (i + 1).toString();
      if (
        searchValue === '' ||
        runNum.includes(searchValue) ||
        run.run_id.toLowerCase().includes(searchValue.toLowerCase())
      ) {
        results.push({
          index: i,
          runId: run.run_id,
          labeled: labeledRunIds.has(run.run_id),
        });
      }
    }
    return results;
  };

  const filteredRuns = showDropdown ? getFilteredRuns() : [];

  return (
    <div style={styles.container}>
      <div style={styles.info}>
        <div style={styles.progress}>
          Run {currentIndex + 1} of {totalRuns}
        </div>
        <div style={styles.details}>
          <span style={styles.label}>Device:</span> {deviceId}
          <span style={styles.separator}>|</span>
          <span style={styles.label}>Run ID:</span> {runId}
        </div>
      </div>
      <div style={styles.buttons}>
        <button
          onClick={onPrevious}
          disabled={!hasPrevious}
          style={{
            ...styles.button,
            opacity: hasPrevious ? 1 : 0.3,
            cursor: hasPrevious ? 'pointer' : 'not-allowed',
          }}
        >
          ← Previous
        </button>

        {/* Search/Pagination input */}
        <div style={styles.searchContainer}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Go to run..."
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            style={styles.searchInput}
          />
          {showDropdown && filteredRuns.length > 0 && (
            <div ref={dropdownRef} style={styles.dropdown}>
              {filteredRuns.map((item) => (
                <div
                  key={item.index}
                  onClick={() => handleGoToRun(item.index)}
                  style={{
                    ...styles.dropdownItem,
                    backgroundColor: item.index === currentIndex ? '#e5e7eb' : 'white',
                  }}
                >
                  <span style={styles.runNumber}>#{item.index + 1}</span>
                  <span style={styles.runIdPreview}>
                    {item.runId.slice(0, 12)}...
                  </span>
                  <span style={{
                    ...styles.labelStatus,
                    backgroundColor: item.labeled ? '#d1fae5' : '#fee2e2',
                    color: item.labeled ? '#059669' : '#dc2626',
                  }}>
                    {item.labeled ? '✓' : '○'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={!hasNext}
          style={{
            ...styles.button,
            opacity: hasNext ? 1 : 0.3,
            cursor: hasNext ? 'pointer' : 'not-allowed',
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 20px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  info: {
    flex: 1,
  },
  progress: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '5px',
  },
  details: {
    fontSize: '14px',
    color: '#6b7280',
  },
  label: {
    fontWeight: '500',
  },
  separator: {
    margin: '0 10px',
  },
  buttons: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  button: {
    padding: '10px 20px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    backgroundColor: 'white',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  searchContainer: {
    position: 'relative' as const,
  },
  searchInput: {
    width: '120px',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
  } as React.CSSProperties,
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '220px',
    maxHeight: '300px',
    overflowY: 'auto' as const,
    backgroundColor: 'white',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: 100,
    marginTop: '4px',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
    gap: '8px',
  } as React.CSSProperties,
  runNumber: {
    fontWeight: '600',
    color: '#374151',
    minWidth: '35px',
  },
  runIdPreview: {
    flex: 1,
    fontSize: '12px',
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  labelStatus: {
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
  },
};
