/**
 * Session launch page component.
 * Allows users to manage sessions: resume, push, delete, or create new.
 */

import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { ClusterIndicator } from './ClusterIndicator';
import type { SessionInfo, ClusterStatus } from '../types';

interface SessionLaunchPageProps {
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;  // Called when user wants to create a new session
  labelerName: string;
  modelType: string;
  pushingSessionId?: string | null;
  refreshTrigger?: number;
}

const PROGRESS_COLORS = {
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#22c55e',
};

export function SessionLaunchPage({
  onSessionSelect,
  onNewSession,
  labelerName: _labelerName,
  modelType: _modelType,
  pushingSessionId,
  refreshTrigger,
}: SessionLaunchPageProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [maxSessions, setMaxSessions] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMaxReachedModal, setShowMaxReachedModal] = useState(false);
  const [showPushConfirm, setShowPushConfirm] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Track cluster status for future use (e.g., showing warnings when cluster is off)
  const [, setClusterStatus] = useState<ClusterStatus>('off');
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [deviceProgress, setDeviceProgress] = useState<{
    device_id: string;
    total_runs: number;
    labeled_count: number;
    progress_percent: number;
  }[] | null>(null);
  const [loadingDeviceProgress, setLoadingDeviceProgress] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const startHideTimeout = () => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredSession(null);
      setDeviceProgress(null);
    }, 150);
  };

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await api.getSessions();
      setSessions(response.sessions);
      setMaxSessions(response.max_sessions);
    } catch (err) {
      setError('Failed to load sessions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // Refresh sessions when refreshTrigger changes (after background push completes)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchSessions();
    }
  }, [refreshTrigger]);

  // Keyboard shortcuts for modals
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Y/Esc when push confirm modal is shown
      if (showPushConfirm && !actionLoading) {
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          event.preventDefault();
          handlePushSession(showPushConfirm);
        } else if (event.key === 'Escape' || event.key === 'n' || event.key === 'N') {
          event.preventDefault();
          setShowPushConfirm(null);
        }
        return;
      }

      // Y/Esc when delete confirm modal is shown
      if (showDeleteConfirm && !actionLoading) {
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          event.preventDefault();
          handleDeleteSession(showDeleteConfirm);
        } else if (event.key === 'Escape' || event.key === 'n' || event.key === 'N') {
          event.preventDefault();
          setShowDeleteConfirm(null);
        }
        return;
      }

      // Esc to close max sessions modal
      if (showMaxReachedModal) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowMaxReachedModal(false);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPushConfirm, showDeleteConfirm, showMaxReachedModal, actionLoading]);

  const handleNewSessionClick = () => {
    if (sessions.length >= maxSessions) {
      setShowMaxReachedModal(true);
    } else {
      onNewSession();  // Go to launch page to create new session
    }
  };

  const handlePushSession = async (sessionId: string) => {
    setShowPushConfirm(null);
    setActionLoading(true);
    try {
      const result = await api.pushSession(sessionId);
      if (result.success) {
        fetchSessions();
      } else {
        setError(result.message || 'Push failed');
      }
    } catch (err) {
      setError('Failed to push session');
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setShowDeleteConfirm(null);
    setActionLoading(true);
    try {
      await api.deleteSession(sessionId);
      fetchSessions();
    } catch (err) {
      setError('Failed to delete session');
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePushAll = async () => {
    setShowMaxReachedModal(false);
    setActionLoading(true);
    try {
      for (const session of sessions) {
        await api.pushSession(session.session_id);
      }
      fetchSessions();
    } catch (err) {
      setError('Failed to push all sessions');
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    // Use UTC to preserve the original date (avoid timezone offset shifting dates)
    const date = new Date(ts * 1000);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  };

  const fetchDeviceProgress = async (sessionId: string) => {
    setLoadingDeviceProgress(true);
    try {
      const devices = await api.getSessionDeviceProgress(sessionId);
      setDeviceProgress(devices);
    } catch (err) {
      console.error('Failed to fetch device progress:', err);
      setDeviceProgress(null);
    } finally {
      setLoadingDeviceProgress(false);
    }
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 100) return PROGRESS_COLORS.green;
    if (percent >= 50) return PROGRESS_COLORS.yellow;
    return PROGRESS_COLORS.red;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
        Loading sessions...
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Header with cluster indicator */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, color: 'black' }}>Labeling Sessions</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#9ca3af', fontSize: '14px' }}>Spark Cluster:</span>
          <ClusterIndicator onStatusChange={setClusterStatus} />
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#ef44441a',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          color: '#ef4444',
          marginBottom: '16px',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>x</button>
        </div>
      )}

      {/* Sessions list with side panel */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        {/* Device Progress Panel (left side) */}
        <div
          data-details-panel
          style={{
            width: hoveredSession ? '280px' : '0px',
            overflow: 'hidden',
            transition: 'width 0.2s ease-in-out',
            flexShrink: 0,
          }}
          onMouseEnter={() => {
            // Keep panel open when hovering over it - clear any pending hide timeout
            clearHideTimeout();
          }}
          onMouseLeave={() => {
            // Start 3-second timeout when leaving the panel
            startHideTimeout();
          }}
        >
          {hoveredSession && (
            <div
              style={{
                width: '280px',
                backgroundColor: '#1f2937',
                borderRadius: '12px',
                padding: '16px',
                height: 'fit-content',
                maxHeight: '500px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ marginBottom: '12px', fontWeight: 'bold', color: '#60a5fa', fontSize: '14px' }}>
                Device Progress
              </div>
              <div style={{ marginBottom: '12px', color: '#9ca3af', fontSize: '12px' }}>
                {(() => {
                  const session = sessions.find(s => s.session_id === hoveredSession);
                  if (!session) return null;
                  return session.name;
                })()}
              </div>
              {loadingDeviceProgress ? (
                <div style={{ color: '#9ca3af', fontSize: '13px' }}>Loading...</div>
              ) : deviceProgress && deviceProgress.length > 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  overflowY: 'auto',
                  maxHeight: '280px',
                  paddingRight: '4px',
                }}>
                  {[...deviceProgress]
                    .sort((a, b) => {
                      // Sort by labeled_count ascending first
                      if (a.labeled_count !== b.labeled_count) {
                        return a.labeled_count - b.labeled_count;
                      }
                      // Then by device_id ascending (natural numeric sort)
                      return a.device_id.localeCompare(b.device_id, undefined, { numeric: true });
                    })
                    .map((device) => (
                    <div
                      key={device.device_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        backgroundColor: getProgressColor(device.progress_percent) + '20',
                        border: `1px solid ${getProgressColor(device.progress_percent)}`,
                        borderRadius: '6px',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: '500',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '140px',
                      }}>
                        {device.device_id}
                      </span>
                      <span style={{
                        color: getProgressColor(device.progress_percent),
                        fontSize: '11px',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}>
                        {device.labeled_count}/{device.total_runs}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#9ca3af', fontSize: '13px' }}>No device data</div>
              )}
              {/* Query Details */}
              {hoveredSession && (
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #374151' }}>
                  <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#60a5fa', fontSize: '13px' }}>
                    Query Details
                  </div>
                  {(() => {
                    const session = sessions.find(s => s.session_id === hoveredSession);
                    if (!session) return null;
                    return (
                      <>
                        <div style={{ marginBottom: '4px', fontSize: '12px' }}>
                          <span style={{ color: '#9ca3af' }}>Date Range:</span>{' '}
                          <span style={{ color: 'white' }}>{formatDate(session.date_range_start)} – {formatDate(session.date_range_end)}</span>
                        </div>
                        <div style={{ marginBottom: '4px', fontSize: '12px' }}>
                          <span style={{ color: '#9ca3af' }}>Model:</span>{' '}
                          <span style={{ color: 'white' }}>{session.model_type}</span>
                        </div>
                        <div style={{ fontSize: '12px' }}>
                          <span style={{ color: '#9ca3af' }}>Labeler:</span>{' '}
                          <span style={{ color: 'white' }}>{session.labeler}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sessions list (right side) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Push in progress indicator */}
          {pushingSessionId && (
            <div style={{
              padding: '12px 16px',
              marginBottom: '12px',
              backgroundColor: '#064e3b',
              border: '1px solid #22c55e',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid #374151',
                  borderTop: '2px solid #22c55e',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <span style={{ color: '#22c55e', fontWeight: '500' }}>
                Pushing labels to Delta Lake...
              </span>
            </div>
          )}
          {sessions.length === 0 ? (
            <div style={{
              padding: '40px',
              textAlign: 'center',
              color: '#9ca3af',
              backgroundColor: '#1f2937',
              borderRadius: '12px',
            }}>
              No saved sessions. Create a new session to start labeling.
            </div>
          ) : (
            sessions
              .filter((session) => session.session_id !== pushingSessionId) // Hide session being pushed
              .map((session) => {
              const isHovered = hoveredSession === session.session_id;
              return (
                <div
                  key={session.session_id}
                  data-session-card
                  style={{
                    padding: '16px',
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    marginBottom: '12px',
                    cursor: 'pointer',
                    border: isHovered ? '2px solid #3b82f6' : '2px solid transparent',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={() => {
                    // Clear any pending hide timeout
                    clearHideTimeout();
                    // Immediately switch to this session (even if another was shown)
                    setHoveredSession(session.session_id);
                    fetchDeviceProgress(session.session_id);
                  }}
                  onMouseLeave={(e) => {
                    // Don't start timeout if moving to the details panel
                    const relatedTarget = e.relatedTarget as HTMLElement;
                    if (relatedTarget?.closest?.('[data-details-panel]')) {
                      return;
                    }
                    // Don't start timeout if moving to another session card
                    if (relatedTarget?.closest?.('[data-session-card]')) {
                      return;
                    }
                    // Start 3-second timeout when leaving
                    startHideTimeout();
                  }}
                  onClick={() => onSessionSelect(session.session_id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <span
                          style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: PROGRESS_COLORS[session.progress_color as keyof typeof PROGRESS_COLORS],
                            boxShadow: `0 0 6px ${PROGRESS_COLORS[session.progress_color as keyof typeof PROGRESS_COLORS]}`,
                          }}
                        />
                        <span style={{ color: 'white', fontWeight: 'bold' }}>{session.name}</span>
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: '14px' }}>
                        {session.labeled_count}/{session.total_runs} runs labeled ({session.progress_percent.toFixed(0)}%)
                        <span style={{ marginLeft: '16px' }}>
                          {formatDate(session.date_range_start)} - {formatDate(session.date_range_end)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setShowPushConfirm(session.session_id)}
                        disabled={actionLoading}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: '#22c55e',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                        }}
                        title="Push labels to Delta Lake"
                      >
                        Push
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(session.session_id)}
                        disabled={actionLoading}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                        }}
                        title="Delete session"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* New session button */}
      <button
        onClick={handleNewSessionClick}
        disabled={actionLoading}
        style={{
          width: '100%',
          padding: '16px',
          backgroundColor: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: 'bold',
        }}
      >
        + New Session
      </button>

      {/* Max sessions reached modal */}
      {showMaxReachedModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowMaxReachedModal(false)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white' }}>
              Maximum Save States Reached ({maxSessions}/{maxSessions})
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 20px 0' }}>
              Would you like to push all labels to Delta Lake?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowMaxReachedModal(false)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                No, manage individually
              </button>
              <button
                onClick={handlePushAll}
                disabled={actionLoading}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                {actionLoading ? 'Pushing...' : 'Yes, push all'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push confirmation modal */}
      {showPushConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowPushConfirm(null)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white' }}>Push Labels?</h3>
            <p style={{ color: '#9ca3af', margin: '0 0 20px 0' }}>
              This will push all labels to Delta Lake and clear the session cache.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowPushConfirm(null)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel (Esc)
              </button>
              <button
                onClick={() => handlePushSession(showPushConfirm)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Push (Y)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowDeleteConfirm(null)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white' }}>Delete Session?</h3>
            <p style={{ color: '#9ca3af', margin: '0 0 20px 0' }}>
              This will permanently delete the session and all cached data. Labels will NOT be pushed to Delta Lake.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel (Esc)
              </button>
              <button
                onClick={() => handleDeleteSession(showDeleteConfirm)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Delete (Y)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard hint */}
      <div style={{ marginTop: '24px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
        Press <kbd style={{ padding: '2px 6px', backgroundColor: '#374151', borderRadius: '4px' }}>Shift+S</kbd> to start Spark cluster
      </div>
    </div>
  );
}
