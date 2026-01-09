/**
 * Time-series chart component using ECharts.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { TimeSeriesPoint } from '../types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  title?: string;
  globalYMax?: number | null;  // Max Y value across all cached runs for consistent scaling
}

// Color palettes for normal and colorblind modes
const COLOR_PALETTES = {
  normal: {
    // Green for main chart horizontal selection
    selected: {
      handle: '#22c55e',
      handleBorder: '#16a34a',
      handleHover: '#16a34a',
      filler: 'rgba(34, 197, 94, 0.25)',
      brush: 'rgba(34, 197, 94, 0.3)',
      line: '#14532d',
      area: 'rgba(34, 197, 94, 0.3)',
      markLine: '#22c55e',
      markArea: 'rgba(34, 197, 94, 0.15)',
    },
    // Red for slider/subgraph selection
    slider: {
      markLine: '#ef4444',      // Red-500
      markArea: 'rgba(239, 68, 68, 0.15)',
    },
    unselected: {
      background: 'rgba(59, 130, 246, 0.15)',
      line: '#1d4ed8',
      area: 'rgba(59, 130, 246, 0.35)',
    },
  },
  colorblind: {
    // Amber for main chart horizontal selection
    selected: {
      handle: '#f59e0b',       // Amber-500
      handleBorder: '#d97706', // Amber-600
      handleHover: '#d97706',
      filler: 'rgba(245, 158, 11, 0.25)',
      brush: 'rgba(245, 158, 11, 0.3)',
      line: '#78350f',         // Amber-900
      area: 'rgba(245, 158, 11, 0.3)',
      markLine: '#f59e0b',
      markArea: 'rgba(245, 158, 11, 0.15)',
    },
    // Magenta/Pink for slider/subgraph selection (distinguishable from amber/blue)
    slider: {
      markLine: '#ec4899',      // Pink-500
      markArea: 'rgba(236, 72, 153, 0.15)',
    },
    unselected: {
      background: 'rgba(59, 130, 246, 0.15)',
      line: '#1d4ed8',
      area: 'rgba(59, 130, 246, 0.35)',
    },
  },
};

export function TimeSeriesChart({ data, title, globalYMax }: TimeSeriesChartProps) {
  const chartRef = useRef<ReactECharts>(null);
  const [autoScaled, setAutoScaled] = useState(false);  // Default uses globalYMax bounds
  const [fullScaleActive, setFullScaleActive] = useState(false);
  const [xZoomRange, setXZoomRange] = useState<{ start: number; end: number }>({ start: 0, end: 100 });
  const [stableZoomRange, setStableZoomRange] = useState<{ start: number; end: number }>({ start: 0, end: 100 });  // Debounced zoom range for Y-axis calc
  const [lockedYBounds, setLockedYBounds] = useState<{ min: number; max: number } | null>(null);
  const [isSliderDrag, setIsSliderDrag] = useState(false);  // Track slider brush drag for red boundary
  const [brushBounds, setBrushBounds] = useState<{ start: number; end: number } | null>(null);  // Brush area being drawn (percentage)
  const [colorblindMode, setColorblindMode] = useState(false);

  // Get current color palette
  const colors = colorblindMode ? COLOR_PALETTES.colorblind : COLOR_PALETTES.normal;

  // Keep ref to current colors for use in event handlers (avoids stale closure)
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  // Debounce stableZoomRange update - only recalculate Y bounds after movement stops
  // This prevents expensive Y-axis recalculations during rapid slider movement
  useEffect(() => {
    const timer = setTimeout(() => {
      setStableZoomRange(xZoomRange);
    }, 150); // 150ms after movement stops
    return () => clearTimeout(timer);
  }, [xZoomRange]);

  // Calculate full time-series bounds (current run's full data)
  // Filter out NaN/null/undefined values, handle negative values
  const { fullYMin, fullYMax } = useMemo(() => {
    if (data.length === 0) return { fullYMin: 0, fullYMax: 100 };
    // Filter to only valid numeric values (handles NaN, null, undefined, Infinity)
    const values = data
      .map((p) => p.value)
      .filter((v) => v != null && Number.isFinite(v));
    if (values.length === 0) return { fullYMin: 0, fullYMax: 100 };
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    return {
      // Use actual min value (supports negative values)
      fullYMin: Math.round((minVal - 1) * 100) / 100,
      fullYMax: Math.round((maxVal + 1) * 100) / 100,
    };
  }, [data]);

  // Calculate default bounds using globalYMax (for initial load)
  const { defaultYMin, defaultYMax } = useMemo(() => {
    if (globalYMax != null) {
      return {
        defaultYMin: 0,
        defaultYMax: Math.round((globalYMax + 1) * 100) / 100,
      };
    }
    // Fallback to current run's full range if globalYMax not available
    return { defaultYMin: fullYMin, defaultYMax: fullYMax };
  }, [globalYMax, fullYMin, fullYMax]);

  // Calculate auto-scale bounds based on visible data (stable zoom range)
  // Uses stableZoomRange (debounced) to avoid recalculation during rapid movement
  // Filter out NaN/null/undefined values, handle negative values
  const { yMin, yMax } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 100 };

    // Filter data to visible range (using stable/debounced range)
    const startIdx = Math.floor((stableZoomRange.start / 100) * data.length);
    const endIdx = Math.ceil((stableZoomRange.end / 100) * data.length);
    const visibleData = data.slice(startIdx, endIdx);

    if (visibleData.length === 0) return { yMin: 0, yMax: 100 };

    // Filter to only valid numeric values (handles NaN, null, undefined, Infinity)
    const values = visibleData
      .map((p) => p.value)
      .filter((v) => v != null && Number.isFinite(v));
    if (values.length === 0) return { yMin: 0, yMax: 100 };

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    return {
      // Use actual min value (supports negative values)
      yMin: Math.round((minVal - 1) * 100) / 100,
      yMax: Math.round((maxVal + 1) * 100) / 100,
    };
  }, [data, stableZoomRange]);

  // Memoize chart data transformation to avoid creating new array on every render
  const chartData = useMemo(() => {
    return data.map((point) => [point.ts * 1000, point.value]);
  }, [data]);

  // Determine actual Y bounds to use:
  // - Auto Scale (A): uses visible data range (yMin/yMax)
  // - Full Scale (S): uses current run's full range (fullYMin/fullYMax via lockedYBounds)
  // - Default: uses globalYMax-based bounds (defaultYMin/defaultYMax)
  const effectiveYMin = autoScaled ? yMin : (lockedYBounds?.min ?? defaultYMin);
  const effectiveYMax = autoScaled ? yMax : (lockedYBounds?.max ?? defaultYMax);

  // Keep a ref to current Y bounds for use in event handlers (avoids stale closure)
  const currentYBoundsRef = useRef({ yMin, yMax });
  currentYBoundsRef.current = { yMin, yMax };

  // Keep a ref to effective Y bounds for use in event handlers
  const effectiveYBoundsRef = useRef({ effectiveYMin, effectiveYMax });
  effectiveYBoundsRef.current = { effectiveYMin, effectiveYMax };

  // Toggle auto-scale (A key) - if in full scale mode, switch to auto-scale
  const toggleAutoScale = useCallback(() => {
    if (fullScaleActive) {
      // In full scale (S) mode, switch to auto-scale (A) mode
      setFullScaleActive(false);
      setLockedYBounds(null);
      setAutoScaled(true);
    } else {
      // Toggle auto-scale on/off
      setAutoScaled((prev) => !prev);
    }
  }, [fullScaleActive]);

  // Calculate full X-axis time range (for locking main chart view)
  const { fullXMin, fullXMax } = useMemo(() => {
    if (data.length === 0) return { fullXMin: undefined, fullXMax: undefined };
    return {
      fullXMin: data[0].ts * 1000,
      fullXMax: data[data.length - 1].ts * 1000,
    };
  }, [data]);

  // Toggle full scale mode (S key)
  const toggleFullScale = useCallback(() => {
    if (fullScaleActive) {
      // Turn off full scale
      setFullScaleActive(false);
      setLockedYBounds(null);
    } else {
      // Turn on full scale, turn off auto-scale
      setFullScaleActive(true);
      setLockedYBounds({ min: fullYMin, max: fullYMax });
      setAutoScaled(false);
    }
  }, [fullScaleActive, fullYMin, fullYMax]);

  // Helper to enable drag-to-zoom mode
  const enableDragZoom = useCallback((chart: any) => {
    chart.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'dataZoomSelect',
      dataZoomSelectActive: true,
    });
  }, []);

  // Epsilon for horizontal drag detection: if mouse Y movement < this fraction of chart height,
  // treat as horizontal-only zoom (keep Y bounds, only zoom X)
  const Y_DRAG_EPSILON = 0.05; // 5% of chart height

  // Track mouse position for drag detection
  const dragStartRef = useRef<{ x: number; y: number; chartHeight: number; chartTop: number } | null>(null);

  // Track current drag mode for visual feedback (horizontal vs rectangular)
  // Use refs to avoid re-renders during drag, only update state on mode change
  const dragModeRef = useRef<'none' | 'horizontal' | 'rectangular'>('none');
  const dragBoundsRef = useRef<{ xStart: number; xEnd: number } | null>(null);
  const [dragOverlay, setDragOverlay] = useState<{ mode: 'horizontal'; xStart: number; xEnd: number } | null>(null);

  // Throttled state setter for slider range - reduces re-renders during rapid movement
  // Uses ref to track last update time, only updates state every 16ms (~60fps) during movement
  const lastRangeUpdateRef = useRef<number>(0);
  const pendingRangeRef = useRef<{ start: number; end: number } | null>(null);

  const setSliderRange = useCallback((start: number, end: number) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastRangeUpdateRef.current;

    // Store pending range
    pendingRangeRef.current = { start, end };

    // Throttle: only update state every 16ms (60fps) to reduce re-renders
    if (timeSinceLastUpdate >= 16) {
      lastRangeUpdateRef.current = now;
      setXZoomRange((prev) => {
        const pending = pendingRangeRef.current;
        if (pending && (prev.start !== pending.start || prev.end !== pending.end)) {
          return pending;
        }
        return prev;
      });
    }
  }, []);

  // Track brush selection start position for real-time preview
  const brushStartRef = useRef<number | null>(null);

  // Track if Q/E sliding is active (to prevent J/L expand during slide)
  const isSlidingRef = useRef<boolean>(false);

  // Keep a ref to current zoom range for use in event handlers
  const xZoomRangeRef = useRef(xZoomRange);
  xZoomRangeRef.current = xZoomRange;

  // Enable drag-to-zoom by default when chart is ready
  const onChartReady = useCallback((chart: any) => {
    enableDragZoom(chart);

    // Get chart grid area dimensions for coordinate conversion
    const getGridBounds = () => {
      const chartWidth = chart.getWidth();
      const chartHeight = chart.getHeight();
      // Grid bounds from config: left 10%, right 5%, bottom 15%, top 15%
      const gridLeft = chartWidth * 0.1;
      const gridRight = chartWidth * 0.95;
      const gridTop = chartHeight * 0.15;
      const gridBottom = chartHeight * 0.85; // 100% - 15% bottom
      return { gridLeft, gridRight, gridTop, gridBottom, gridHeight: gridBottom - gridTop };
    };

    // Track drag state for boundary preview
    chart.getZr().on('mousedown', (e: any) => {
      const chartHeight = chart.getHeight();
      const chartWidth = chart.getWidth();
      const { gridTop, gridBottom, gridHeight } = getGridBounds();

      // Check if click is in the main chart area (not slider)
      const dataShadowTop = chartHeight - 55; // Slider starts around here

      if (e.offsetY < dataShadowTop && e.offsetY >= gridTop && e.offsetY <= gridBottom) {
        // Record normalized Y position (0 = top of grid, 1 = bottom of grid)
        const normalizedY = (e.offsetY - gridTop) / gridHeight;
        dragStartRef.current = {
          x: e.offsetX,
          y: normalizedY,
          chartHeight: gridHeight,
          chartTop: gridTop,
        };
      }

      // Slider interaction - show red boundary for any slider drag (handles or brush)
      const sliderDataShadowTop = chartHeight - 55;  // Slider area starts here
      if (e.offsetY > sliderDataShadowTop) {
        setIsSliderDrag(true);

        // Additional brush selection tracking (for clicks between handles)
        const sliderBrushTop = chartHeight - 25;
        if (e.offsetY > sliderBrushTop) {
          const gridLeft = chartWidth * 0.1;
          const gridRight = chartWidth * 0.95;
          const gridWidth = gridRight - gridLeft;

          const currentStart = xZoomRangeRef.current.start;
          const currentEnd = xZoomRangeRef.current.end;

          const handleLeftX = gridLeft + (currentStart / 100) * gridWidth;
          const handleRightX = gridLeft + (currentEnd / 100) * gridWidth;

          const clickX = e.offsetX;
          const handleEpsilon = 15;

          const nearLeftHandle = Math.abs(clickX - handleLeftX) < handleEpsilon;
          const nearRightHandle = Math.abs(clickX - handleRightX) < handleEpsilon;

          if (!nearLeftHandle && !nearRightHandle) {
            brushStartRef.current = e.offsetX;
          }
        }
      }
    });

    chart.getZr().on('mousemove', (e: any) => {
      // Track drag mode for visual feedback on main chart
      if (dragStartRef.current !== null) {
        const { gridTop, gridHeight, gridLeft, gridRight } = getGridBounds();
        const normalizedY = (e.offsetY - gridTop) / gridHeight;
        const yDelta = Math.abs(normalizedY - dragStartRef.current.y);

        // Determine drag mode based on Y movement
        const newMode = yDelta < Y_DRAG_EPSILON ? 'horizontal' : 'rectangular';
        const prevMode = dragModeRef.current;
        dragModeRef.current = newMode;

        // Calculate bounds for visual overlay
        const gridWidth = gridRight - gridLeft;

        // Convert pixel positions to data coordinates
        const option = chart.getOption();
        const xAxisData = option.series?.[0]?.data || [];
        if (xAxisData.length > 0) {
          const fullXMin = xAxisData[0][0];
          const fullXMax = xAxisData[xAxisData.length - 1][0];
          const xRange = fullXMax - fullXMin;

          const startXPct = (dragStartRef.current.x - gridLeft) / gridWidth;
          const endXPct = (e.offsetX - gridLeft) / gridWidth;

          const xStart = fullXMin + Math.min(startXPct, endXPct) * xRange;
          const xEnd = fullXMin + Math.max(startXPct, endXPct) * xRange;

          dragBoundsRef.current = { xStart, xEnd };

          // Only update state (trigger re-render) when in horizontal mode or mode changes
          if (newMode === 'horizontal') {
            setDragOverlay({ mode: 'horizontal', xStart, xEnd });
          } else if (prevMode === 'horizontal') {
            // Switching from horizontal to rectangular - clear overlay
            setDragOverlay(null);
          }
        }
      }

      // If we have a brush start position, calculate preview range and brush bounds
      if (brushStartRef.current !== null) {
        const chartWidth = chart.getWidth();
        const gridLeft = chartWidth * 0.1;
        const gridRight = chartWidth * 0.95;
        const gridWidth = gridRight - gridLeft;

        const startX = Math.max(gridLeft, Math.min(gridRight, brushStartRef.current));
        const endX = Math.max(gridLeft, Math.min(gridRight, e.offsetX));

        const startPct = ((Math.min(startX, endX) - gridLeft) / gridWidth) * 100;
        const endPct = ((Math.max(startX, endX) - gridLeft) / gridWidth) * 100;

        setSliderRange(Math.max(0, startPct), Math.min(100, endPct));
        // Track brush bounds for red box overlay
        setBrushBounds({ start: Math.max(0, startPct), end: Math.min(100, endPct) });
      }
    });

    chart.getZr().on('mouseup', (e: any) => {
      // Check for horizontal drag on main chart
      if (dragStartRef.current !== null) {
        const { gridTop, gridHeight } = getGridBounds();
        const normalizedEndY = (e.offsetY - gridTop) / gridHeight;
        const yDelta = Math.abs(normalizedEndY - dragStartRef.current.y);

        if (yDelta < Y_DRAG_EPSILON) {
          // Set flag to reset Y on next dataZoom event
          (chart as any).__horizontalDragDetected = true;
        } else {
          (chart as any).__horizontalDragDetected = false;
        }
        dragStartRef.current = null;
      }

      // If we were doing a brush selection, dispatch zoom action
      if (brushStartRef.current !== null) {
        const currentRange = xZoomRangeRef.current;
        setTimeout(() => {
          chart.dispatchAction({
            type: 'dataZoom',
            dataZoomIndex: 0,
            start: currentRange.start,
            end: currentRange.end,
          });
        }, 10);
      }
      setIsSliderDrag(false);
      setBrushBounds(null);
      brushStartRef.current = null;

      // Reset drag mode visual feedback
      dragModeRef.current = 'none';
      dragBoundsRef.current = null;
      setDragOverlay(null);
    });

    chart.getZr().on('globalout', () => {
      setIsSliderDrag(false);
      setBrushBounds(null);
      brushStartRef.current = null;
      dragStartRef.current = null;
      dragModeRef.current = 'none';
      dragBoundsRef.current = null;
      setDragOverlay(null);
    });

    // Main dataZoom event handler - fires in real-time when realtime: true
    chart.on('dataZoom', (params: any) => {
      // Clear selection by toggling cursor off then on
      chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'dataZoomSelect',
        dataZoomSelectActive: false,
      });

      // Extract start/end from various event formats
      let newXStart: number | undefined;
      let newXEnd: number | undefined;

      // Direct params (most common for slider)
      if (params.start !== undefined && params.end !== undefined) {
        newXStart = params.start;
        newXEnd = params.end;
      }
      // Batch params (box select)
      else if (params.batch) {
        const xZoom = params.batch.find((b: any) =>
          b.dataZoomId === 'sliderZoom' || b.dataZoomId?.includes('slider') || b.xAxisIndex === 0
        );
        if (xZoom) {
          newXStart = xZoom.start;
          newXEnd = xZoom.end;
        }
      }

      // Update slider range state directly
      if (newXStart !== undefined && newXEnd !== undefined) {
        setSliderRange(newXStart, newXEnd);
      }

      // Handle Y-axis box zoom with bidirectional selection logic
      // Check if this is a box selection (has batch with X and Y zoom)
      if (params.batch && params.batch.length >= 2) {
        const isHorizontalDrag = (chart as any).__horizontalDragDetected;

        if (isHorizontalDrag) {
          // Reset the flag
          (chart as any).__horizontalDragDetected = false;

          // Get the X zoom values before resetting
          const xZoomBatch = params.batch.find((b: any) => b.dataZoomId?.includes('xAxis'));
          const xStart = xZoomBatch?.startValue;
          const xEnd = xZoomBatch?.endValue;

          // Reset Y axis by dispatching restore then re-applying X zoom
          setTimeout(() => {
            // First restore to reset both X and Y
            chart.dispatchAction({ type: 'restore' });

            // Then re-apply just the X zoom using the slider
            if (xStart !== undefined && xEnd !== undefined) {
              setTimeout(() => {
                // Convert timestamp values to percentage for slider
                const option = chart.getOption();
                const xAxisData = option.series[0]?.data || [];
                if (xAxisData.length > 0) {
                  const fullXMin = xAxisData[0][0];
                  const fullXMax = xAxisData[xAxisData.length - 1][0];
                  const xRange = fullXMax - fullXMin;

                  const startPct = ((xStart - fullXMin) / xRange) * 100;
                  const endPct = ((xEnd - fullXMin) / xRange) * 100;

                  chart.dispatchAction({
                    type: 'dataZoom',
                    dataZoomIndex: 0,
                    start: Math.max(0, startPct),
                    end: Math.min(100, endPct),
                  });
                }
              }, 20);
            }
          }, 10);
        } else {
          // Rectangular selection - keep both X and Y zoom as-is
          setAutoScaled(false);
        }
      }

      setTimeout(() => enableDragZoom(chart), 50);
    });

    // Re-enable after restore action and reset zoom tracking
    chart.on('restore', () => {
      chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'dataZoomSelect',
        dataZoomSelectActive: false,
      });
      setSliderRange(0, 100);

      // Re-apply current slider colors after restore (fixes colorblind mode reset bug)
      const currentColors = colorsRef.current;
      setTimeout(() => {
        chart.setOption({
          dataZoom: [{
            id: 'sliderZoom',
            handleStyle: {
              color: currentColors.selected.handle,
              borderColor: currentColors.selected.handleBorder,
            },
            emphasis: {
              handleStyle: {
                color: currentColors.selected.handleHover,
              },
            },
            fillerColor: currentColors.selected.filler,
            brushStyle: {
              color: currentColors.selected.brush,
            },
            dataBackground: {
              lineStyle: { color: currentColors.unselected.line },
              areaStyle: { color: currentColors.unselected.area },
            },
            selectedDataBackground: {
              lineStyle: { color: currentColors.selected.line },
              areaStyle: { color: currentColors.selected.area },
            },
          }],
        });
        enableDragZoom(chart);
      }, 50);
    });
  }, [enableDragZoom, setSliderRange]);

  // Handle keyboard shortcuts: Ctrl+Z to undo zoom, 'a' to toggle auto-scale
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        toggleAutoScale();
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        toggleFullScale();
      } else if (event.key === 'r' || event.key === 'R') {
        const chart = chartRef.current?.getEchartsInstance();
        if (chart) {
          event.preventDefault();
          chart.dispatchAction({ type: 'restore' });
        }
      } else if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        setColorblindMode((prev) => !prev);
      } else if (event.code === 'KeyU' || event.code === 'KeyJ') {
        // U: shrink left boundary (inward), J: expand left boundary (outward)
        // Skip if Q/E sliding is active to prevent conflicts
        if (isSlidingRef.current) return;
        event.preventDefault();
        const chart = chartRef.current?.getEchartsInstance();
        if (chart) {
          const currentRange = xZoomRangeRef.current;
          const step = 5; // 5% step
          let newStart: number;
          if (event.code === 'KeyJ') {
            // J: expand left (move start outward/left)
            newStart = Math.max(0, currentRange.start - step);
          } else {
            // U: shrink left (move start inward/right)
            newStart = Math.min(currentRange.end - step, currentRange.start + step);
          }
          chart.dispatchAction({
            type: 'dataZoom',
            dataZoomIndex: 0,
            start: newStart,
            end: currentRange.end,
          });
        }
      } else if (event.code === 'KeyO' || event.code === 'KeyL') {
        // O: shrink right boundary (inward), L: expand right boundary (outward)
        // Skip if Q/E sliding is active to prevent conflicts
        if (isSlidingRef.current) return;
        event.preventDefault();
        const chart = chartRef.current?.getEchartsInstance();
        if (chart) {
          const currentRange = xZoomRangeRef.current;
          const step = 5; // 5% step
          let newEnd: number;
          if (event.code === 'KeyL') {
            // L: expand right (move end outward/right)
            newEnd = Math.min(100, currentRange.end + step);
          } else {
            // O: shrink right (move end inward/left)
            newEnd = Math.max(currentRange.start + step, currentRange.end - step);
          }
          chart.dispatchAction({
            type: 'dataZoom',
            dataZoomIndex: 0,
            start: currentRange.start,
            end: newEnd,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAutoScale, toggleFullScale]);

  // Continuous Q/E slider movement while key is held
  useEffect(() => {
    let animationId: number | null = null;
    let direction: 'left' | 'right' | null = null;

    const moveSlider = () => {
      const chart = chartRef.current?.getEchartsInstance();
      if (!chart || !direction) return;

      const currentRange = xZoomRangeRef.current;
      const windowSize = currentRange.end - currentRange.start;
      const step = Math.max(0.5, windowSize * 0.02); // Smooth 2% step per frame

      let newStart: number, newEnd: number;

      if (direction === 'left') {
        newStart = Math.max(0, currentRange.start - step);
        newEnd = newStart + windowSize;
        if (newEnd > 100) newEnd = 100;
      } else {
        newEnd = Math.min(100, currentRange.end + step);
        newStart = newEnd - windowSize;
        if (newStart < 0) newStart = 0;
      }

      chart.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: newStart,
        end: newEnd,
      });

      animationId = requestAnimationFrame(moveSlider);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if ((event.key === 'q' || event.key === 'Q') && direction !== 'left') {
        event.preventDefault();
        direction = 'left';
        isSlidingRef.current = true;
        if (!animationId) animationId = requestAnimationFrame(moveSlider);
      } else if ((event.key === 'e' || event.key === 'E') && direction !== 'right') {
        event.preventDefault();
        direction = 'right';
        isSlidingRef.current = true;
        if (!animationId) animationId = requestAnimationFrame(moveSlider);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if ((event.key === 'q' || event.key === 'Q') && direction === 'left') {
        direction = null;
        isSlidingRef.current = false;
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
        }
      } else if ((event.key === 'e' || event.key === 'E') && direction === 'right') {
        direction = null;
        isSlidingRef.current = false;
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, []);

  // Calculate selection boundary timestamps based on slider position (for preview)
  const selectionStartTs = useMemo(() => {
    if (data.length === 0) return undefined;
    const idx = Math.max(0, Math.floor((xZoomRange.start / 100) * (data.length - 1)));
    return data[idx]?.ts * 1000;
  }, [data, xZoomRange.start]);

  const selectionEndTs = useMemo(() => {
    if (data.length === 0) return undefined;
    const idx = Math.min(data.length - 1, Math.ceil((xZoomRange.end / 100) * (data.length - 1)));
    return data[idx]?.ts * 1000;
  }, [data, xZoomRange.end]);

  // Check if we have a non-full selection to show boundary preview
  const hasSelection = xZoomRange.start > 0.5 || xZoomRange.end < 99.5;

  const option = {
    animation: false,  // Disable animation for instant chart rendering on navigation
    title: {
      text: title || 'Time Series Data',
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const point = params[0];
        const date = new Date(point.value[0] * 1000).toLocaleString();
        return `${date}<br/>Value: ${point.value[1].toFixed(2)}`;
      },
    },
    xAxis: {
      type: 'time',
      name: 'Time',
      // During slider drag: lock to full view to show red boundary preview
      // After release: let dataZoom control the zoom
      min: isSliderDrag ? fullXMin : undefined,
      max: isSliderDrag ? fullXMax : undefined,
    },
    yAxis: {
      type: 'value',
      name: 'Value',
      min: effectiveYMin,
      max: effectiveYMax,
    },
    series: [
      {
        type: 'line',
        data: chartData,
        smooth: false,
        symbol: 'none',
        // Large dataset optimizations (kicks in at >2800 points)
        sampling: 'lttb',        // Largest-Triangle-Three-Buckets downsampling for display
        large: true,             // Use canvas optimization for large datasets
        largeThreshold: 2800,    // Enable large mode when > 2800 points
        progressive: 400,        // Render in chunks of 400 points
        lineStyle: {
          width: 2,
        },
        // Show red boundary preview during slider drag only
        markLine: isSliderDrag && hasSelection && selectionStartTs && selectionEndTs ? {
          silent: true,
          symbol: 'none',
          lineStyle: {
            color: colors.slider.markLine,
            width: 2,
            type: 'solid',
          },
          label: {
            show: false,
          },
          data: [
            { xAxis: selectionStartTs },
            { xAxis: selectionEndTs },
          ],
        } : undefined,
        // Show drag selection overlay OR slider boundary preview
        markArea: (() => {
          // Priority 1: Show green/amber overlay ONLY for horizontal drag mode
          // Rectangular mode uses ECharts default blue brush (no custom overlay)
          if (dragOverlay) {
            return {
              silent: true,
              itemStyle: {
                color: colors.selected.markArea,
                borderColor: colors.selected.markLine,
                borderWidth: 2,
              },
              data: [[
                { xAxis: dragOverlay.xStart },
                { xAxis: dragOverlay.xEnd },
              ]],
            };
          }
          // Priority 2: Show red slider boundary preview during slider drag only
          if (isSliderDrag && hasSelection && selectionStartTs && selectionEndTs) {
            return {
              silent: true,
              itemStyle: {
                color: colors.slider.markArea,
                borderWidth: 0,
              },
              data: [[
                { xAxis: selectionStartTs },
                { xAxis: selectionEndTs },
              ]],
            };
          }
          return undefined;
        })(),
      },
    ],
    dataZoom: [
      {
        id: 'sliderZoom',
        type: 'slider',
        xAxisIndex: 0,  // Control main X-axis - zooms chart to selection
        height: 40,
        realtime: true,
        throttle: 0,
        showDetail: true,
        showDataShadow: true,
        brushSelect: true,  // Re-enabled - click to select new region
        handleSize: '120%',
        // Remove any border on the slider itself
        borderColor: 'transparent',
        // Light opaque blue background for non-selected areas
        backgroundColor: colors.unselected.background,
        handleStyle: {
          color: colors.selected.handle,
          borderColor: colors.selected.handleBorder,
        },
        emphasis: {
          handleStyle: {
            color: colors.selected.handleHover,
          },
        },
        // Fill for the selected window area
        fillerColor: colors.selected.filler,
        // Brush style when making new selections
        brushStyle: {
          color: colors.selected.brush,
        },
        // Data shadow in non-selected areas
        dataBackground: {
          lineStyle: {
            color: colors.unselected.line,
            width: 1,
          },
          areaStyle: {
            color: colors.unselected.area,
          },
        },
        // Data shadow in selected area
        selectedDataBackground: {
          lineStyle: {
            color: colors.selected.line,
          },
          areaStyle: {
            color: colors.selected.area,
          },
        },
      },
      {
        type: 'inside',
        xAxisIndex: 0,  // Also allow mouse wheel zoom on main chart
      },
      {
        type: 'inside',
        yAxisIndex: 0,  // Y-axis scroll zoom
      },
    ],
    toolbox: {
      feature: {
        dataZoom: {
          yAxisIndex: 0,
          xAxisIndex: 0,
          title: {
            zoom: 'Drag to zoom',
            back: 'Undo zoom',
          },
          brushStyle: {
            // Blue brush for rectangular selection (visible when outside epsilon)
            borderWidth: 2,
            borderColor: '#3b82f6',
            color: 'rgba(59, 130, 246, 0.25)',
          },
        },
        restore: {
          title: 'Reset',
        },
        saveAsImage: {
          title: 'Save',
        },
      },
    },
    grid: {
      left: '10%',
      right: '5%',
      bottom: '15%',
      top: '15%',
    },
  };

  return (
    <div style={{ width: '100%', height: '500px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, display: 'flex', gap: '8px' }}>
        <button
          onClick={toggleAutoScale}
          style={{
            padding: '6px 12px',
            backgroundColor: autoScaled ? '#3b82f6' : '#e5e7eb',
            color: autoScaled ? 'white' : '#374151',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
          title="Press 'A' to toggle"
        >
          {autoScaled
            ? `Auto Scale: ${yMin.toFixed(2)} - ${yMax.toFixed(2)}`
            : 'Auto Scale OFF'}
        </button>
        <button
          onClick={toggleFullScale}
          style={{
            padding: '6px 12px',
            backgroundColor: fullScaleActive ? '#10b981' : '#e5e7eb',
            color: fullScaleActive ? 'white' : '#374151',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
          title="Press 'S' to toggle full time-series scale"
        >
          {fullScaleActive
            ? `Full Scale: ${fullYMin.toFixed(2)} - ${fullYMax.toFixed(2)}`
            : 'Full Scale OFF'}
        </button>
        <button
          onClick={() => setColorblindMode((prev) => !prev)}
          style={{
            padding: '6px 12px',
            backgroundColor: colorblindMode ? '#f59e0b' : '#e5e7eb',
            color: colorblindMode ? 'white' : '#374151',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
          title="Press 'C' to toggle colorblind mode"
        >
          {colorblindMode ? 'Colorblind Mode ON' : 'Colorblind Mode'}
        </button>
      </div>
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: '100%', width: '100%' }}
        onChartReady={onChartReady}
        // dataZoom events handled in onChartReady to avoid duplicate handlers
      />
      {/* Red brush box overlay on slider - aligned with data area */}
      {brushBounds && (
        <div
          style={{
            position: 'absolute',
            left: `${10 + (brushBounds.start / 100) * 85}%`,
            width: `${((brushBounds.end - brushBounds.start) / 100) * 85}%`,
            bottom: 0,
            height: 36,
            backgroundColor: colors.slider.markArea,
            border: `2px solid ${colors.slider.markLine}`,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}
    </div>
  );
}
