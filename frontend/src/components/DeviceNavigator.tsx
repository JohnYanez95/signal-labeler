/**
 * Device navigation component for switching between devices during a labeling session.
 * Shows available devices, finished devices, and current device progress.
 */

import { useState, useEffect, useRef } from 'react';

interface DeviceProgress {
  deviceId: string;
  labeledCount: number;
  totalRuns: number;
}

interface DeviceNavigatorProps {
  devices: DeviceProgress[];
  currentDeviceId: string | null;
  onDeviceSelect: (deviceId: string) => void;
  labelerName: string;
  modelType: string;
}

export function DeviceNavigator({
  devices,
  currentDeviceId,
  onDeviceSelect,
  labelerName,
  modelType,
}: DeviceNavigatorProps) {
  const [showAvailable, setShowAvailable] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const availableRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (showAvailable && availableRef.current && !availableRef.current.contains(target)) {
        setShowAvailable(false);
      }
      if (showFinished && finishedRef.current && !finishedRef.current.contains(target)) {
        setShowFinished(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAvailable, showFinished]);

  // Handle device selection - close dropdown after selecting
  const handleAvailableDeviceSelect = (deviceId: string) => {
    setShowAvailable(false);
    onDeviceSelect(deviceId);
  };

  const handleFinishedDeviceSelect = (deviceId: string) => {
    setShowFinished(false);
    onDeviceSelect(deviceId);
  };

  // Toggle available dropdown - close finished if open
  const toggleAvailable = () => {
    setShowAvailable(!showAvailable);
    if (!showAvailable) setShowFinished(false);
  };

  // Toggle finished dropdown - close available if open
  const toggleFinished = () => {
    setShowFinished(!showFinished);
    if (!showFinished) setShowAvailable(false);
  };

  // Separate devices into available (incomplete) and finished (all labeled)
  const availableDevices = devices.filter(d => d.labeledCount < d.totalRuns);
  const finishedDevices = devices.filter(d => d.labeledCount >= d.totalRuns && d.totalRuns > 0);

  // Get current device info
  const currentDevice = devices.find(d => d.deviceId === currentDeviceId);

  // Calculate totals
  const totalLabeled = devices.reduce((sum, d) => sum + d.labeledCount, 0);
  const totalRuns = devices.reduce((sum, d) => sum + d.totalRuns, 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.infoRow}>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Labeler:</span>
            <span style={styles.infoValue}>{labelerName}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Model:</span>
            <span style={styles.infoValue}>{modelType}</span>
          </div>
        </div>
      </div>

      <div style={styles.deviceSection}>
        {/* Current Device */}
        <div style={styles.currentDevice}>
          <span style={styles.currentLabel}>Current Device:</span>
          <span style={styles.currentValue}>
            {currentDevice ? (
              <>
                {currentDevice.deviceId}
                <span style={styles.deviceProgress}>
                  ({currentDevice.labeledCount}/{currentDevice.totalRuns} runs)
                </span>
              </>
            ) : (
              'None selected'
            )}
          </span>
        </div>

        {/* Device Lists */}
        <div style={styles.deviceLists}>
          {/* Available Devices */}
          <div style={styles.deviceListContainer} ref={availableRef}>
            <button
              onClick={toggleAvailable}
              style={styles.listToggle}
            >
              <span>Available ({availableDevices.length})</span>
              <span style={styles.toggleArrow}>{showAvailable ? '▼' : '▶'}</span>
            </button>
            {showAvailable && (
              <div style={styles.deviceList}>
                {availableDevices.length === 0 ? (
                  <div style={styles.emptyList}>All devices complete!</div>
                ) : (
                  availableDevices.map(device => (
                    <button
                      key={device.deviceId}
                      onClick={() => handleAvailableDeviceSelect(device.deviceId)}
                      style={{
                        ...styles.deviceItem,
                        ...(device.deviceId === currentDeviceId ? styles.deviceItemActive : {}),
                      }}
                    >
                      <span style={styles.deviceName}>{device.deviceId}</span>
                      <span style={styles.deviceCount}>
                        {device.labeledCount}/{device.totalRuns}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Finished Devices */}
          <div style={styles.deviceListContainer} ref={finishedRef}>
            <button
              onClick={toggleFinished}
              style={{...styles.listToggle, ...styles.listToggleFinished}}
            >
              <span>Finished ({finishedDevices.length})</span>
              <span style={styles.toggleArrow}>{showFinished ? '▼' : '▶'}</span>
            </button>
            {showFinished && (
              <div style={{...styles.deviceList, ...styles.deviceListFinished}}>
                {finishedDevices.length === 0 ? (
                  <div style={styles.emptyList}>No devices finished yet</div>
                ) : (
                  finishedDevices.map(device => (
                    <button
                      key={device.deviceId}
                      onClick={() => handleFinishedDeviceSelect(device.deviceId)}
                      style={{
                        ...styles.deviceItem,
                        ...styles.deviceItemFinished,
                        ...(device.deviceId === currentDeviceId ? styles.deviceItemActive : {}),
                      }}
                    >
                      <span style={styles.deviceName}>{device.deviceId}</span>
                      <span style={styles.deviceCount}>✓ {device.totalRuns}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Session Progress Bar */}
      <div style={styles.progressSection}>
        <div style={styles.progressLabel}>
          Session Progress: {totalLabeled} / {totalRuns} runs
        </div>
        <div style={styles.progressBarOuter}>
          <div
            style={{
              ...styles.progressBarInner,
              width: `${totalRuns > 0 ? (totalLabeled / totalRuns) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: '15px 20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    marginBottom: '20px',
  },
  header: {
    marginBottom: '15px',
    paddingBottom: '10px',
    borderBottom: '1px solid #e5e7eb',
  },
  infoRow: {
    display: 'flex',
    gap: '30px',
    flexWrap: 'wrap',
  },
  infoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  infoLabel: {
    fontSize: '13px',
    color: '#6b7280',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: '14px',
    color: '#111827',
    fontWeight: '600',
    backgroundColor: '#f3f4f6',
    padding: '4px 10px',
    borderRadius: '4px',
  },
  deviceSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  currentDevice: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 15px',
    backgroundColor: '#dbeafe',
    borderRadius: '6px',
  },
  currentLabel: {
    fontSize: '13px',
    color: '#1e40af',
    fontWeight: '500',
  },
  currentValue: {
    fontSize: '15px',
    color: '#1e40af',
    fontWeight: '600',
  },
  deviceProgress: {
    marginLeft: '8px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#3b82f6',
  },
  deviceLists: {
    display: 'flex',
    gap: '15px',
    flexWrap: 'wrap',
  },
  deviceListContainer: {
    flex: '1 1 200px',
    minWidth: '200px',
  },
  listToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    backgroundColor: '#f9fafb',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
  },
  listToggleFinished: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
    color: '#166534',
  },
  toggleArrow: {
    fontSize: '10px',
  },
  deviceList: {
    marginTop: '6px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  deviceListFinished: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  emptyList: {
    padding: '12px',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '13px',
    fontStyle: 'italic',
  },
  deviceItem: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    border: 'none',
    borderBottom: '1px solid #f3f4f6',
    backgroundColor: 'white',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  deviceItemActive: {
    backgroundColor: '#dbeafe',
    fontWeight: '600',
  },
  deviceItemFinished: {
    backgroundColor: '#f0fdf4',
  },
  deviceName: {
    fontFamily: 'monospace',
    color: '#374151',
  },
  deviceCount: {
    color: '#6b7280',
    fontSize: '12px',
  },
  progressSection: {
    marginTop: '15px',
    paddingTop: '12px',
    borderTop: '1px solid #e5e7eb',
  },
  progressLabel: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '6px',
  },
  progressBarOuter: {
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
};
