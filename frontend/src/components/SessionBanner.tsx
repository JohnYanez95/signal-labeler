/**
 * Session banner component.
 * Shows current session progress and notifications (like 80% completion).
 */

import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { SessionProgressResponse } from '../types';

interface SessionBannerProps {
  sessionId: string;
  onProgressChange?: (progress: SessionProgressResponse) => void;
  pollInterval?: number;
  // Optional local progress for instant updates (overrides polled data for display)
  localLabeledCount?: number;
  localTotalRuns?: number;
}

const PROGRESS_COLORS = {
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#22c55e',
};

export function SessionBanner({
  sessionId,
  onProgressChange,
  pollInterval = 5000,
  localLabeledCount,
  localTotalRuns,
}: SessionBannerProps) {
  const [progress, setProgress] = useState<SessionProgressResponse | null>(null);
  const [showClusterNotification, setShowClusterNotification] = useState(false);
  const [notificationDismissed, setNotificationDismissed] = useState(false);

  // Use local progress if provided, otherwise fall back to polled data
  const hasLocalProgress = localLabeledCount !== undefined && localTotalRuns !== undefined;
  const displayLabeledCount = hasLocalProgress ? localLabeledCount : (progress?.labeled_count ?? 0);
  const displayTotalRuns = hasLocalProgress ? localTotalRuns : (progress?.total_runs ?? 0);
  const displayPercent = displayTotalRuns > 0 ? (displayLabeledCount / displayTotalRuns) * 100 : 0;
  const displayColor = displayPercent >= 90 ? 'green' : displayPercent >= 70 ? 'yellow' : 'red';

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const response = await api.getSessionProgress(sessionId);
        setProgress(response);
        onProgressChange?.(response);

        // Show cluster notification when reaching 80%
        if (response.at_80_percent && !notificationDismissed) {
          setShowClusterNotification(true);
        }
      } catch (error) {
        console.error('Failed to fetch session progress:', error);
      }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, pollInterval);
    return () => clearInterval(interval);
  }, [sessionId, pollInterval, onProgressChange, notificationDismissed]);

  const handleDismissNotification = () => {
    setShowClusterNotification(false);
    setNotificationDismissed(true);
  };

  const handleStartCluster = async () => {
    try {
      await api.startCluster();
      setShowClusterNotification(false);
      setNotificationDismissed(true);
    } catch (error) {
      console.error('Failed to start cluster:', error);
    }
  };

  // Don't render until we have either local progress or polled data
  if (!hasLocalProgress && !progress) {
    return null;
  }

  return (
    <>
      {/* Progress bar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          backgroundColor: '#374151',
          zIndex: 100,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${displayPercent}%`,
            backgroundColor: PROGRESS_COLORS[displayColor],
            transition: 'width 0.3s ease, background-color 0.3s ease',
          }}
        />
      </div>

      {/* Progress text */}
      <div
        style={{
          position: 'fixed',
          top: '8px',
          right: '16px',
          padding: '4px 12px',
          backgroundColor: '#1f2937',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#9ca3af',
          zIndex: 100,
        }}
      >
        <span style={{ color: PROGRESS_COLORS[displayColor], fontWeight: 'bold' }}>
          {displayLabeledCount}
        </span>
        <span> / {displayTotalRuns} runs</span>
        <span style={{ marginLeft: '8px', color: PROGRESS_COLORS[displayColor] }}>
          ({displayPercent.toFixed(0)}%)
        </span>
      </div>

      {/* 80% completion notification */}
      {showClusterNotification && (
        <div
          style={{
            position: 'fixed',
            top: '48px',
            right: '16px',
            padding: '16px',
            backgroundColor: '#1f2937',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            border: '1px solid #f59e0b',
            zIndex: 1000,
            maxWidth: '320px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>*</span>
              <span style={{ color: 'white', fontWeight: 'bold' }}>80% Complete!</span>
            </div>
            <button
              onClick={handleDismissNotification}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: '16px',
              }}
            >
              x
            </button>
          </div>
          <p style={{ color: '#9ca3af', margin: '0 0 12px 0', fontSize: '14px' }}>
            Consider starting the Spark cluster to prepare for pushing your labels.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleDismissNotification}
              style={{
                flex: 1,
                padding: '8px',
                backgroundColor: '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Later
            </button>
            <button
              onClick={handleStartCluster}
              style={{
                flex: 1,
                padding: '8px',
                backgroundColor: '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Start Cluster
            </button>
          </div>
        </div>
      )}
    </>
  );
}
