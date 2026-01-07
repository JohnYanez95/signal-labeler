/**
 * Device selection and configuration component.
 */

import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { User, ModelType, DeviceMetadata } from '../types';

interface DeviceSelectorProps {
  onLoadRuns: (
    deviceIds: string[],  // All devices to include in session
    startTs: number,
    endTs: number,
    modelType: string,
    sampleSize: number,
    labelerName: string
  ) => void;
  disabled?: boolean;
  completedDevices?: string[];
  onDevicesLoaded?: (devices: string[]) => void;
  autoSelectDevice?: string | null;  // Auto-select this device and start labeling
  sessionActive?: boolean;  // Whether a labeling session is currently active
  onNotification?: (message: string) => void;  // Callback for showing notifications
}

export function DeviceSelector({ onLoadRuns, disabled, completedDevices = [], onDevicesLoaded, autoSelectDevice, sessionActive = false, onNotification }: DeviceSelectorProps) {
  const [allDevices, setAllDevices] = useState<string[]>([]);  // All devices from API
  const [allDeviceMetadata, setAllDeviceMetadata] = useState<DeviceMetadata[]>([]);  // Device metadata with run counts
  const [devices, setDevices] = useState<string[]>([]);  // Filtered available devices
  const [minRunsPerDevice, setMinRunsPerDevice] = useState(1);  // Minimum runs to include device
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedFromFinished, setSelectedFromFinished] = useState(false);
  const [isRandomSelection, setIsRandomSelection] = useState(true);  // Track if device was randomly selected
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceSearchFocused, setDeviceSearchFocused] = useState(false);
  const [finishedDeviceSearch, setFinishedDeviceSearch] = useState('');
  const [finishedDeviceSearchFocused, setFinishedDeviceSearchFocused] = useState(false);
  // Default to current month
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  });
  const [sampleSize, setSampleSize] = useState(30);
  const [deviceSampleSize, setDeviceSampleSize] = useState<number | null>(null);  // null = use all devices
  const [modelType, setModelType] = useState('classification_v1');
  const [labelerName, setLabelerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Users and Models from database
  const [users, setUsers] = useState<User[]>([]);
  const [models, setModels] = useState<ModelType[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchFocused, setUserSearchFocused] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSearchFocused, setModelSearchFocused] = useState(false);

  // Device filter list (user-provided list of device IDs to filter to)
  const [deviceFilterText, setDeviceFilterText] = useState('');
  const [showDeviceFilter, setShowDeviceFilter] = useState(false);
  const [hoveredPill, setHoveredPill] = useState<string | null>(null);

  // Track if labeler name was set from system (locked to prevent impersonation)
  const [labelerLocked, setLabelerLocked] = useState(false);

  // Parse device filter list from text input
  const parseDeviceFilter = (text: string): Set<string> => {
    if (!text.trim()) return new Set();

    // Try parsing as JSON array first
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return new Set(parsed.map(s => String(s).trim()).filter(s => s.length > 0));
        }
      } catch {
        // Not valid JSON, fall through to text parsing
      }
    }

    // Split by newlines, commas, or whitespace and filter empty strings
    // Also strip quotes that might be left over from partial JSON
    return new Set(
      text
        .split(/[\n,\s]+/)
        .map(s => s.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, ''))
        .filter(s => s.length > 0)
    );
  };

  const deviceFilterSet = parseDeviceFilter(deviceFilterText);
  const hasDeviceFilter = deviceFilterSet.size > 0;

  // Categorize filtered devices into found and not found
  const getFilteredDeviceStatus = () => {
    if (!hasDeviceFilter) return { found: [], notFound: [] };

    const found: string[] = [];
    const notFound: string[] = [];

    // Check against allDevices (not filtered by completedDevices)
    deviceFilterSet.forEach(deviceId => {
      if (allDevices.includes(deviceId)) {
        found.push(deviceId);
      } else {
        notFound.push(deviceId);
      }
    });

    return { found, notFound };
  };

  const { found: foundDevices, notFound: notFoundDevices } = getFilteredDeviceStatus();

  // Max devices to show in dropdown (for performance with large device lists)
  const MAX_DEVICES_DISPLAY = 100;

  // Filter devices based on search
  const filteredDevicesAll = devices.filter(device =>
    device.toLowerCase().includes(deviceSearch.toLowerCase())
  );
  // Limit to max display count
  const filteredDevices = filteredDevicesAll.slice(0, MAX_DEVICES_DISPLAY);
  const hasMoreDevices = filteredDevicesAll.length > MAX_DEVICES_DISPLAY;

  // Filter finished devices based on search
  const filteredFinishedDevicesAll = completedDevices.filter(device =>
    device.toLowerCase().includes(finishedDeviceSearch.toLowerCase())
  );
  const filteredFinishedDevices = filteredFinishedDevicesAll.slice(0, MAX_DEVICES_DISPLAY);
  const hasMoreFinishedDevices = filteredFinishedDevicesAll.length > MAX_DEVICES_DISPLAY;

  // Filter users based on search
  const filteredUsers = users.filter(user =>
    user.user_name.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Filter models based on search
  const filteredModels = models.filter(model =>
    model.model_name.toLowerCase().includes(modelSearch.toLowerCase())
  );

  // Load users and models on mount
  useEffect(() => {
    loadUsersAndModels();
  }, []);

  const loadUsersAndModels = async () => {
    try {
      const [userList, modelList, systemUsername] = await Promise.all([
        api.getUsers(),
        api.getModels(),
        api.getSystemUsername(),
      ]);
      setUsers(userList);
      setModels(modelList);
      // Set default model if available and not already set
      if (modelList.length > 0 && !modelType) {
        setModelType(modelList[0].model_name);
      }
      // Autofill labeler name with system username if not already set
      // Lock it to prevent impersonation
      if (systemUsername && !labelerName) {
        setLabelerName(systemUsername);
        setLabelerLocked(true);
      }
    } catch (err) {
      console.error('Failed to load users/models:', err);
    }
  };

  const handleSelectUser = async (userName: string) => {
    setLabelerName(userName);
    setUserSearchFocused(false);
    setUserSearch('');
  };

  const handleCreateUser = async () => {
    const name = userSearch.trim();
    if (!name) return;
    try {
      const newUser = await api.createUser(name);
      setUsers(prev => [...prev, newUser].sort((a, b) => a.user_name.localeCompare(b.user_name)));
      setLabelerName(newUser.user_name);
      setUserSearchFocused(false);
      setUserSearch('');
    } catch (err) {
      console.error('Failed to create user:', err);
    }
  };

  const handleSelectModel = async (modelName: string) => {
    setModelType(modelName);
    setModelSearchFocused(false);
    setModelSearch('');
  };

  const handleCreateModel = async () => {
    const name = modelSearch.trim();
    if (!name) return;
    try {
      const newModel = await api.createModel(name);
      setModels(prev => [...prev, newModel].sort((a, b) => a.model_name.localeCompare(b.model_name)));
      setModelType(newModel.model_name);
      setModelSearchFocused(false);
      setModelSearch('');
    } catch (err) {
      console.error('Failed to create model:', err);
    }
  };

  // Re-apply device filter when filter text, device sample size, or min runs changes
  // This is fast since device metadata is already in memory from the Query
  useEffect(() => {
    applyDeviceFilter();
  }, [deviceFilterText, deviceSampleSize, minRunsPerDevice, allDeviceMetadata, completedDevices]);

  // Handle auto-select device (for continuing with random device)
  useEffect(() => {
    if (autoSelectDevice && devices.includes(autoSelectDevice) && labelerName.trim()) {
      setSelectedDevice(autoSelectDevice);
      // Auto-start labeling - pass all available devices
      const startTs = new Date(startDate).getTime() / 1000;
      const endTs = new Date(endDate).getTime() / 1000;
      onLoadRuns(devices, startTs, endTs, modelType, sampleSize, labelerName);
    }
  }, [autoSelectDevice, devices]);

  const applyDeviceFilter = () => {
    // Start with device metadata to filter by run count, then filter out completed ones
    let availableDevices = allDeviceMetadata
      .filter(d => d.run_count >= minRunsPerDevice)  // Filter by min runs
      .filter(d => !completedDevices.includes(d.device_id))
      .map(d => d.device_id);

    // If user provided a filter list, only include devices in that list
    if (hasDeviceFilter) {
      availableDevices = availableDevices.filter(d => deviceFilterSet.has(d));
    } else if (deviceSampleSize !== null && deviceSampleSize > 0) {
      // If no filter list but device sample size is set, randomly sample devices
      if (availableDevices.length > deviceSampleSize) {
        // Shuffle and take first N (deterministic based on device IDs for consistency)
        const shuffled = [...availableDevices].sort(() => Math.random() - 0.5);
        availableDevices = shuffled.slice(0, deviceSampleSize);
      }
    }

    setDevices(availableDevices);
    onDevicesLoaded?.(availableDevices);

    // Update selection if current selection is no longer valid
    if (selectedDevice && !availableDevices.includes(selectedDevice) && !selectedFromFinished) {
      // Randomly select a device if current selection is invalid
      const randomIdx = Math.floor(Math.random() * availableDevices.length);
      setSelectedDevice(availableDevices.length > 0 ? availableDevices[randomIdx] : '');
      setIsRandomSelection(true);
    } else if (!selectedDevice && availableDevices.length > 0) {
      // Randomly select initial device
      const randomIdx = Math.floor(Math.random() * availableDevices.length);
      setSelectedDevice(availableDevices[randomIdx]);
      setIsRandomSelection(true);
    }
  };

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    onNotification?.('Querying Delta Lake for devices... (starting Spark if needed)');

    try {
      const startTs = new Date(startDate).getTime() / 1000;
      const endTs = new Date(endDate).getTime() / 1000;
      // Query Delta Lake directly for device metadata
      const response = await api.queryDeltaDevices(
        startTs,
        endTs,
        labelerName.trim() ? modelType : undefined,
        labelerName.trim() || undefined
      );
      // Store full device metadata for filtering by run count
      setAllDeviceMetadata(response.devices);
      // Extract device IDs from the metadata response
      const deviceList = response.devices.map(d => d.device_id);
      setAllDevices(deviceList);

      // Apply filters (min runs + completed devices + user filter list OR device sample size)
      let availableDevices = response.devices
        .filter(d => d.run_count >= minRunsPerDevice)  // Filter by min runs
        .filter(d => !completedDevices.includes(d.device_id))
        .map(d => d.device_id);

      if (hasDeviceFilter) {
        availableDevices = availableDevices.filter(d => deviceFilterSet.has(d));
      } else if (deviceSampleSize !== null && deviceSampleSize > 0) {
        // If no filter list but device sample size is set, randomly sample devices
        if (availableDevices.length > deviceSampleSize) {
          const shuffled = [...availableDevices].sort(() => Math.random() - 0.5);
          availableDevices = shuffled.slice(0, deviceSampleSize);
        }
      }

      setDevices(availableDevices);
      // Notify parent of available devices
      onDevicesLoaded?.(availableDevices);

      // Show result notification with run count info
      const filteredOutByMinRuns = deviceList.length - response.devices.filter(d => d.run_count >= minRunsPerDevice).length;
      if (deviceList.length === 0) {
        onNotification?.('No devices found in Delta Lake for this date range.');
      } else if (availableDevices.length === 0) {
        const extraInfo = filteredOutByMinRuns > 0 ? ` (${filteredOutByMinRuns} filtered by min runs)` : '';
        onNotification?.(`Found ${deviceList.length} devices (${response.total_runs} runs), but all are completed or filtered out${extraInfo}.`);
      } else {
        const extraInfo = filteredOutByMinRuns > 0 ? ` (${filteredOutByMinRuns} excluded by min runs filter)` : '';
        onNotification?.(`Found ${availableDevices.length} devices with ${response.total_runs} total runs ready for labeling${extraInfo}.`);
      }

      if (availableDevices.length > 0 && !selectedDevice) {
        // Randomly select initial device
        const randomIdx = Math.floor(Math.random() * availableDevices.length);
        setSelectedDevice(availableDevices[randomIdx]);
        setIsRandomSelection(true);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load devices';
      setError(errorMsg);
      onNotification?.(`Query failed: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRuns = () => {
    if (devices.length === 0) {
      alert('No devices available. Please query first.');
      return;
    }
    if (!labelerName.trim()) {
      alert('Please enter your name');
      return;
    }

    const startTs = new Date(startDate).getTime() / 1000;
    const endTs = new Date(endDate).getTime() / 1000;

    // Pass ALL available devices to the session, not just the selected one
    onLoadRuns(devices, startTs, endTs, modelType, sampleSize, labelerName);
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Session Configuration</h2>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.grid}>
        <div style={styles.fieldRelative}>
          <label style={styles.label}>
            Your Name
            {labelerLocked && !sessionActive && (
              <span style={{ marginLeft: '8px', fontSize: '11px', color: '#6b7280' }} title="Detected from system - cannot be changed">
                🔒
              </span>
            )}
          </label>
          {sessionActive || labelerLocked ? (
            <input
              type="text"
              value={labelerName}
              style={{ ...styles.input, ...styles.inputLocked }}
              readOnly
              title={labelerLocked ? 'Locked to system username to prevent impersonation' : undefined}
            />
          ) : (
            <>
              <input
                type="text"
                placeholder="Search or add user..."
                value={userSearchFocused ? userSearch : labelerName}
                onChange={(e) => setUserSearch(e.target.value)}
                onFocus={() => {
                  setUserSearchFocused(true);
                  setUserSearch('');
                }}
                onBlur={() => setTimeout(() => setUserSearchFocused(false), 150)}
                style={{
                  ...styles.input,
                  backgroundColor: labelerName && !userSearchFocused ? '#dbeafe' : 'white',
                  color: labelerName && !userSearchFocused ? '#1e40af' : 'inherit',
                }}
              />
              {userSearchFocused && (
                <div style={styles.dropdown}>
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => (
                      <div
                        key={user.user_id}
                        onClick={() => handleSelectUser(user.user_name)}
                        style={styles.dropdownItem}
                      >
                        {user.user_name}
                      </div>
                    ))
                  ) : userSearch.trim() ? (
                    <div
                      onClick={handleCreateUser}
                      style={{ ...styles.dropdownItem, ...styles.dropdownCreate }}
                    >
                      + Create "{userSearch.trim()}"
                    </div>
                  ) : (
                    <div style={styles.dropdownEmpty}>Type to search or add...</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div style={styles.fieldRelative}>
          <label style={styles.label}>Model Type</label>
          {sessionActive ? (
            <input
              type="text"
              value={modelType}
              style={{ ...styles.input, ...styles.inputLocked }}
              readOnly
            />
          ) : (
            <>
              <input
                type="text"
                placeholder="Search or add model..."
                value={modelSearchFocused ? modelSearch : modelType}
                onChange={(e) => setModelSearch(e.target.value)}
                onFocus={() => {
                  setModelSearchFocused(true);
                  setModelSearch('');
                }}
                onBlur={() => setTimeout(() => setModelSearchFocused(false), 150)}
                style={{
                  ...styles.input,
                  backgroundColor: modelType && !modelSearchFocused ? '#d1fae5' : 'white',
                  color: modelType && !modelSearchFocused ? '#065f46' : 'inherit',
                }}
              />
              {modelSearchFocused && (
                <div style={styles.dropdown}>
                  {filteredModels.length > 0 ? (
                    filteredModels.map((model) => (
                      <div
                        key={model.model_id}
                        onClick={() => handleSelectModel(model.model_name)}
                        style={styles.dropdownItem}
                      >
                        {model.model_name}
                      </div>
                    ))
                  ) : modelSearch.trim() ? (
                    <div
                      onClick={handleCreateModel}
                      style={{ ...styles.dropdownItem, ...styles.dropdownCreate }}
                    >
                      + Create "{modelSearch.trim()}"
                    </div>
                  ) : (
                    <div style={styles.dropdownEmpty}>Type to search or add...</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!sessionActive && (
          <>
            <div style={styles.field}>
              <label style={styles.label}>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>End Date</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  onClick={loadDevices}
                  disabled={loading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: loading ? '#9ca3af' : '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="Query devices for this date range"
                >
                  {loading ? '...' : 'Query'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Device Filter List - collapsible, only show before session starts */}
        {!sessionActive && (
        <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
          <button
            type="button"
            onClick={() => setShowDeviceFilter(!showDeviceFilter)}
            style={styles.filterToggle}
          >
            {showDeviceFilter ? '▼' : '▶'} Filter by Device List
            {hasDeviceFilter && (
              <span style={styles.filterBadge}>
                {deviceFilterSet.size} device{deviceFilterSet.size !== 1 ? 's' : ''}
              </span>
            )}
          </button>
          {showDeviceFilter && (
            <div style={styles.filterContainer}>
              <div style={styles.textareaWrapper}>
                <div
                  style={styles.textareaHighlight}
                  dangerouslySetInnerHTML={{
                    __html: hoveredPill
                      ? deviceFilterText.replace(
                          new RegExp(`(${hoveredPill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'),
                          `<mark style="background-color: ${foundDevices.includes(hoveredPill) ? '#86efac' : '#fcd34d'}; border-radius: 2px;">$1</mark>`
                        )
                      : deviceFilterText || '&nbsp;',
                  }}
                />
                <textarea
                  value={deviceFilterText}
                  onChange={(e) => setDeviceFilterText(e.target.value)}
                  onKeyDown={(e) => {
                    // Ctrl+Enter to load runs if there are found devices
                    if (e.ctrlKey && e.key === 'Enter' && foundDevices.length > 0 && labelerName.trim()) {
                      e.preventDefault();
                      handleLoadRuns();
                    }
                  }}
                  placeholder="Paste device IDs here (one per line, comma-separated, space-separated, or JSON array)... Ctrl+Enter to load"
                  style={styles.filterTextarea}
                  rows={3}
                />
              </div>
              {hasDeviceFilter && (
                <>
                  <div style={styles.filterInfo}>
                    <span style={{ color: '#065f46' }}>{foundDevices.length} found</span>
                    {notFoundDevices.length > 0 && (
                      <span style={{ color: '#92400e' }}>, {notFoundDevices.length} not found</span>
                    )}
                  </div>
                  <div style={styles.pillContainer}>
                    {foundDevices.map(device => (
                      <span
                        key={device}
                        style={{
                          ...styles.pillFound,
                          ...(hoveredPill === device ? styles.pillFoundHover : {}),
                        }}
                        onMouseEnter={() => setHoveredPill(device)}
                        onMouseLeave={() => setHoveredPill(null)}
                      >
                        {device}
                      </span>
                    ))}
                    {notFoundDevices.map(device => (
                      <span
                        key={device}
                        style={{
                          ...styles.pillNotFound,
                          ...(hoveredPill === device ? styles.pillNotFoundHover : {}),
                        }}
                        onMouseEnter={() => setHoveredPill(device)}
                        onMouseLeave={() => setHoveredPill(null)}
                      >
                        {device}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeviceFilterText('')}
                    style={styles.clearFilterButton}
                  >
                    Clear Filter
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        )}

        <div style={styles.fieldRelative}>
          <label style={styles.label}>
            Device ({devices.length} available
            {!sessionActive && allDeviceMetadata.length > 0 && devices.length < allDeviceMetadata.length && (
              <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>
                {' '}/ {allDeviceMetadata.length} total
                {minRunsPerDevice > 1 && ` (min ${minRunsPerDevice} runs)`}
              </span>
            )}
            {hasDeviceFilter && !sessionActive ? ' - filtered' : ''})
            {selectedDevice && isRandomSelection && !selectedFromFinished && (
              <span style={styles.randomBadge}>Random</span>
            )}
          </label>
          <input
            type="text"
            placeholder="Search devices..."
            value={deviceSearchFocused ? deviceSearch : (selectedDevice && !selectedFromFinished ? selectedDevice : '')}
            onChange={(e) => setDeviceSearch(e.target.value)}
            onFocus={() => {
              setDeviceSearchFocused(true);
              setDeviceSearch('');
            }}
            onBlur={() => setTimeout(() => setDeviceSearchFocused(false), 150)}
            style={{
              ...styles.input,
              backgroundColor: selectedDevice && !selectedFromFinished && !deviceSearchFocused ? '#dbeafe' : 'white',
              color: selectedDevice && !selectedFromFinished && !deviceSearchFocused ? '#1e40af' : 'inherit',
            }}
          />
          {deviceSearchFocused && (
            <select
              value={selectedDevice}
              onChange={(e) => {
                setSelectedDevice(e.target.value);
                setSelectedFromFinished(false);
                setIsRandomSelection(false);  // User made a choice
                setDeviceSearchFocused(false);
                setDeviceSearch('');
              }}
              style={styles.dropdown}
              disabled={loading || devices.length === 0}
              size={Math.min(6, Math.max(1, filteredDevices.length + (hasMoreDevices ? 2 : 1)))}
            >
              <option value="">
                {hasMoreDevices
                  ? `Showing ${filteredDevices.length} of ${filteredDevicesAll.length} - type to search`
                  : `Select a device (${filteredDevices.length} shown)`}
              </option>
              {filteredDevices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
              {hasMoreDevices && (
                <option value="" disabled style={{ fontStyle: 'italic', color: '#9ca3af' }}>
                  ... {filteredDevicesAll.length - MAX_DEVICES_DISPLAY} more - refine search
                </option>
              )}
            </select>
          )}
        </div>

        {completedDevices.length > 0 && (
          <div style={styles.fieldRelative}>
            <label style={styles.label}>Finished Devices ({completedDevices.length})</label>
            <input
              type="text"
              placeholder="Search finished devices..."
              value={finishedDeviceSearchFocused ? finishedDeviceSearch : (selectedDevice && selectedFromFinished ? selectedDevice : '')}
              onChange={(e) => setFinishedDeviceSearch(e.target.value)}
              onFocus={() => {
                setFinishedDeviceSearchFocused(true);
                setFinishedDeviceSearch('');
              }}
              onBlur={() => setTimeout(() => setFinishedDeviceSearchFocused(false), 150)}
              style={{
                ...styles.input,
                backgroundColor: selectedDevice && selectedFromFinished && !finishedDeviceSearchFocused ? '#bbf7d0' : '#f0fdf4',
                borderColor: '#86efac',
                color: selectedDevice && selectedFromFinished && !finishedDeviceSearchFocused ? '#166534' : 'inherit',
              }}
            />
            {finishedDeviceSearchFocused && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDevice(e.target.value);
                    setSelectedFromFinished(true);
                    setFinishedDeviceSearchFocused(false);
                    setFinishedDeviceSearch('');
                  }
                }}
                style={{
                  ...styles.dropdown,
                  backgroundColor: '#f0fdf4',
                  borderColor: '#86efac',
                }}
                disabled={loading}
                size={Math.min(6, Math.max(1, filteredFinishedDevices.length + (hasMoreFinishedDevices ? 2 : 1)))}
              >
                <option value="">
                  {hasMoreFinishedDevices
                    ? `Showing ${filteredFinishedDevices.length} of ${filteredFinishedDevicesAll.length} - type to search`
                    : `Revisit a finished device (${filteredFinishedDevices.length} shown)`}
                </option>
                {filteredFinishedDevices.map((device) => (
                  <option key={device} value={device}>
                    {device}
                  </option>
                ))}
                {hasMoreFinishedDevices && (
                  <option value="" disabled style={{ fontStyle: 'italic', color: '#9ca3af' }}>
                    ... {filteredFinishedDevicesAll.length - MAX_DEVICES_DISPLAY} more - refine search
                  </option>
                )}
              </select>
            )}
          </div>
        )}

        {!sessionActive && (
          <>
            <div style={styles.field}>
              <label style={styles.label}>
                Min Runs per Device
                <span style={styles.labelHint}> (filter)</span>
              </label>
              <select
                value={minRunsPerDevice}
                onChange={(e) => setMinRunsPerDevice(parseInt(e.target.value))}
                style={styles.select}
                title="Exclude devices with fewer runs than this value"
              >
                {/* Generate options from 1 to sampleSize */}
                {[1, 5, 10, 15, 20, 24, 30, 50, 100]
                  .filter(n => n <= sampleSize)
                  .map(n => (
                    <option key={n} value={n}>
                      {n}{n === 1 ? ' (No filter)' : ''}
                    </option>
                  ))
                }
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Runs per Device</label>
              <select
                value={sampleSize}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value);
                  setSampleSize(newSize);
                  // Ensure minRunsPerDevice doesn't exceed new sample size
                  if (minRunsPerDevice > newSize) {
                    setMinRunsPerDevice(newSize);
                  }
                }}
                style={styles.select}
              >
                <option value={10}>10</option>
                <option value={24}>24</option>
                <option value={30}>30 (Default)</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </>
        )}

        {/* Device Sample Size - only shows when NOT using filter by device list */}
        {!sessionActive && !hasDeviceFilter && (
          <div style={styles.field}>
            <label style={styles.label}>
              Device Sample Size
              <span style={styles.labelHint}> (random)</span>
            </label>
            <div style={styles.selectWithHint}>
              <select
                value={deviceSampleSize ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setDeviceSampleSize(val === '' ? null : parseInt(val));
                }}
                style={{ ...styles.select, flexShrink: 0, width: 'auto' }}
              >
                <option value="">All devices ({allDevices.filter(d => !completedDevices.includes(d)).length})</option>
                <option value={5}>5 devices</option>
                <option value={10}>10 devices</option>
                <option value={20}>20 devices</option>
                <option value={50}>50 devices</option>
                <option value={100}>100 devices</option>
              </select>
              <span style={styles.inlineHint}>
                Or use "Filter by Device List" for specific devices
              </span>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleLoadRuns}
        disabled={disabled || loading || devices.length === 0}
        style={{
          ...styles.button,
          opacity: disabled || loading || devices.length === 0 ? 0.5 : 1,
          cursor: disabled || loading || devices.length === 0 ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Loading...' : `Load Runs (${devices.length} devices)`}
      </button>
    </div>
  );
}

const styles = {
  container: {
    padding: '25px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    marginBottom: '25px',
  },
  title: {
    margin: '0 0 20px 0',
    fontSize: '20px',
    fontWeight: '600',
    color: '#111827',
  },
  error: {
    padding: '10px',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '6px',
    marginBottom: '15px',
    fontSize: '14px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  fieldRelative: {
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '5px',
  },
  labelHint: {
    fontWeight: '400',
    color: '#9ca3af',
    fontSize: '12px',
  } as React.CSSProperties,
  randomBadge: {
    marginLeft: '8px',
    padding: '2px 6px',
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '500',
  } as React.CSSProperties,
  fieldHint: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
  } as React.CSSProperties,
  selectWithHint: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  inlineHint: {
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
  } as React.CSSProperties,
  input: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
  },
  inputLocked: {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    cursor: 'not-allowed',
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'white',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'white',
    zIndex: 100,
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginTop: '4px',
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  dropdownItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
  } as React.CSSProperties,
  dropdownCreate: {
    color: '#059669',
    fontWeight: '500',
  } as React.CSSProperties,
  dropdownEmpty: {
    padding: '8px 12px',
    color: '#9ca3af',
    fontStyle: 'italic',
  } as React.CSSProperties,
  selectedDevice: {
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: '#dbeafe',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#1e40af',
    fontWeight: '500',
  },
  button: {
    width: '100%',
    padding: '12px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: '#3b82f6',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    transition: 'background-color 0.2s',
  } as React.CSSProperties,
  filterToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    backgroundColor: '#f9fafb',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
    width: 'fit-content',
  } as React.CSSProperties,
  filterBadge: {
    padding: '2px 8px',
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  } as React.CSSProperties,
  filterContainer: {
    marginTop: '10px',
    padding: '12px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: '#f9fafb',
  } as React.CSSProperties,
  textareaWrapper: {
    position: 'relative' as const,
    width: '100%',
  } as React.CSSProperties,
  textareaHighlight: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: '8px 12px',
    fontSize: '13px',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordWrap: 'break-word' as const,
    color: 'transparent',
    pointerEvents: 'none' as const,
    overflow: 'hidden',
    borderRadius: '6px',
    border: '1px solid transparent',
  } as React.CSSProperties,
  filterTextarea: {
    position: 'relative' as const,
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'monospace',
    resize: 'vertical' as const,
    minHeight: '80px',
    backgroundColor: 'transparent',
    caretColor: '#000',
  } as React.CSSProperties,
  filterInfo: {
    marginTop: '8px',
    fontSize: '13px',
    color: '#059669',
    fontWeight: '500',
  } as React.CSSProperties,
  clearFilterButton: {
    marginTop: '8px',
    padding: '6px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    backgroundColor: 'white',
    fontSize: '13px',
    color: '#6b7280',
    cursor: 'pointer',
  } as React.CSSProperties,
  pillContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
    marginTop: '8px',
    maxHeight: '150px',
    overflowY: 'auto' as const,
    padding: '4px',
  } as React.CSSProperties,
  pillFound: {
    padding: '4px 10px',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
    fontFamily: 'monospace',
    border: '1px solid #a7f3d0',
    cursor: 'default',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  pillFoundHover: {
    backgroundColor: '#065f46',
    color: '#d1fae5',
    border: '1px solid #065f46',
  } as React.CSSProperties,
  pillNotFound: {
    padding: '4px 10px',
    backgroundColor: '#fef3c7',
    color: '#92400e',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
    fontFamily: 'monospace',
    border: '1px solid #fcd34d',
    cursor: 'default',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  pillNotFoundHover: {
    backgroundColor: '#92400e',
    color: '#fef3c7',
    border: '1px solid #92400e',
  } as React.CSSProperties,
};
