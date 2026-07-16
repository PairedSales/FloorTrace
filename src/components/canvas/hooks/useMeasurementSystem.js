import { useState, useCallback, useEffect } from 'react';

export function useMeasurementSystem({
  measurementLines,
  onMeasurementLinesChange,
  setSelectedCustomShapeIndex,
}) {
  const [selectedMeasurementLineIndex, setSelectedMeasurementLineIndex] = useState(null);
  const [localMeasurementLine, setLocalMeasurementLine] = useState(null);

  // Sync selected index when lines change
  useEffect(() => {
    if (selectedMeasurementLineIndex !== null && selectedMeasurementLineIndex >= measurementLines.length) {
      setSelectedMeasurementLineIndex(null);
    }
  }, [measurementLines, selectedMeasurementLineIndex]);

  const handleMeasurementLineSelect = useCallback((index, e) => {
    e.cancelBubble = true;
    setSelectedMeasurementLineIndex(index);
    setSelectedCustomShapeIndex?.(null);
  }, [setSelectedCustomShapeIndex]);

  const handleMeasurementLineDragEnd = useCallback((index, e) => {
    if (!onMeasurementLinesChange) return;
    e.cancelBubble = true;
    const deltaX = e.target.x();
    const deltaY = e.target.y();
    if (!deltaX && !deltaY) return;

    const nextLines = measurementLines.map((line, lineIndex) => (
      lineIndex === index
        ? {
          ...line,
          start: { x: line.start.x + deltaX, y: line.start.y + deltaY },
          end: { x: line.end.x + deltaX, y: line.end.y + deltaY }
        }
        : line
    ));

    e.target.position({ x: 0, y: 0 });
    onMeasurementLinesChange(nextLines);
  }, [measurementLines, onMeasurementLinesChange]);

  return {
    selectedMeasurementLineIndex,
    setSelectedMeasurementLineIndex,
    localMeasurementLine,
    setLocalMeasurementLine,
    handleMeasurementLineSelect,
    handleMeasurementLineDragEnd,
  };
}
