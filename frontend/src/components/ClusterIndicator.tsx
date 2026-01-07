/**
 * Spark cluster status indicator component.
 * Shows a colored dot with tooltip and click-to-start functionality.
 * Color fades from green → yellow → red as timeout approaches.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import type { ClusterStatus } from '../types';

interface ClusterIndicatorProps {
  onStatusChange?: (status: ClusterStatus) => void;
  showTimer?: boolean;  // Show timer text next to indicator
}

const STATUS_LABELS: Record<ClusterStatus, string> = {
  off: 'Cluster Off',
  starting: 'Starting...',
  on: 'Cluster Running',
};

// Interpolate between two colors based on ratio (0-1)
function interpolateColor(color1: string, color2: string, ratio: number): string {
  const hex = (c: string) => parseInt(c, 16);
  const r1 = hex(color1.slice(1, 3)), g1 = hex(color1.slice(3, 5)), b1 = hex(color1.slice(5, 7));
  const r2 = hex(color2.slice(1, 3)), g2 = hex(color2.slice(3, 5)), b2 = hex(color2.slice(5, 7));
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Get color based on timeout remaining (180 seconds max)
function getTimeoutColor(seconds: number | null, status: ClusterStatus): string {
  if (status === 'off') return '#ef4444';  // Red
  if (status === 'starting') return '#f59e0b';  // Yellow/Amber
  if (seconds === null) return '#22c55e';  // Green (no timeout info)

  const maxTimeout = 180;  // 3 minutes
  const ratio = Math.max(0, Math.min(1, seconds / maxTimeout));

  if (ratio > 0.5) {
    // Green to Yellow (100% to 50%)
    const greenToYellowRatio = (ratio - 0.5) * 2;  // 1 at 100%, 0 at 50%
    return interpolateColor('#f59e0b', '#22c55e', greenToYellowRatio);
  } else {
    // Yellow to Red (50% to 0%)
    const yellowToRedRatio = ratio * 2;  // 1 at 50%, 0 at 0%
    return interpolateColor('#ef4444', '#f59e0b', yellowToRedRatio);
  }
}

export function ClusterIndicator({
  onStatusChange,
  showTimer = true,
}: ClusterIndicatorProps) {
  const [status, setStatus] = useState<ClusterStatus>('off');
  const [secondsUntilTimeout, setSecondsUntilTimeout] = useState<number | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Calculate dynamic color based on timeout
  const indicatorColor = useMemo(
    () => getTimeoutColor(secondsUntilTimeout, status),
    [secondsUntilTimeout, status]
  );

  // Poll more frequently when cluster is running to keep timer accurate
  const pollInterval = status === 'on' ? 1000 : 5000;

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.getClusterStatus();
      setStatus(response.status);
      setSecondsUntilTimeout(response.seconds_until_timeout);
      onStatusChange?.(response.status);
    } catch (error) {
      console.error('Failed to fetch cluster status:', error);
    }
  }, [onStatusChange]);

  const handleStartCluster = useCallback(async () => {
    setShowConfirm(false);
    setLoading(true);
    try {
      const response = await api.startCluster();
      setStatus(response.status);
      setSecondsUntilTimeout(response.seconds_until_timeout);
      onStatusChange?.(response.status);
    } catch (error) {
      console.error('Failed to start cluster:', error);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  // Initial fetch and polling
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  // Keyboard handler for Y/N when confirmation is shown
  useEffect(() => {
    if (!showConfirm) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
        event.preventDefault();
        handleStartCluster();
      } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
        event.preventDefault();
        setShowConfirm(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfirm, handleStartCluster]);

  const handleClick = () => {
    if (status === 'off') {
      setShowConfirm(true);
    }
  };

  const formatTimeout = (seconds: number | null): string => {
    if (seconds === null) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      {/* Status dot */}
      <button
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        disabled={loading || status === 'starting'}
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: indicatorColor,
          border: 'none',
          cursor: status === 'off' ? 'pointer' : 'default',
          boxShadow: `0 0 8px ${indicatorColor}`,
          transition: 'all 0.3s ease',
          animation: status === 'starting' ? 'pulse 1.5s infinite' : 'none',
        }}
        title={STATUS_LABELS[status]}
      />

      {/* Timer display */}
      {showTimer && status === 'on' && secondsUntilTimeout !== null && (
        <span style={{
          color: indicatorColor,
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          transition: 'color 0.3s ease',
        }}>
          {formatTimeout(secondsUntilTimeout)}
        </span>
      )}
      {showTimer && status === 'starting' && (
        <span style={{ color: '#f59e0b', fontSize: '12px' }}>Starting...</span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '8px 12px',
            backgroundColor: '#1f2937',
            color: 'white',
            borderRadius: '6px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            zIndex: 1000,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {STATUS_LABELS[status]}
          </div>
          {status === 'off' && (
            <div style={{ color: '#9ca3af' }}>Click to start</div>
          )}
          {status === 'on' && secondsUntilTimeout !== null && (
            <div style={{ color: '#9ca3af' }}>
              Timeout in {formatTimeout(secondsUntilTimeout)}
            </div>
          )}
          {status === 'starting' && (
            <div style={{ color: '#9ca3af' }}>Please wait...</div>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white' }}>
              Start Spark Cluster?
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 12px 0' }}>
              The cluster will automatically shut down after 3 minutes of inactivity.
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 20px 0', fontSize: '14px' }}>
              Press <strong style={{ color: '#9ca3af' }}>Y</strong> to confirm, <strong style={{ color: '#9ca3af' }}>N</strong> to cancel
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                No (N)
              </button>
              <button
                onClick={handleStartCluster}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Yes (Y)
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
