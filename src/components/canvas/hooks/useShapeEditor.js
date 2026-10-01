import { useState, useCallback, useEffect } from 'react';

export function useShapeEditor({
  customShapes,
  onCustomShapesChange,
  setSelectedMeasurementLineIndex,
}) {
  const [selectedCustomShapeIndex, setSelectedCustomShapeIndex] = useState(null);

  // An index into `customShapes`, so any change of that array's identity — a
  // shape added, deleted, dragged, or the whole set cleared — makes the held
  // index mean a different shape than the one the user selected. Same rule as
  // `selectedVertexIndex` in usePerimeterEditor, which is where this pattern
  // is documented.
  useEffect(() => {
    setSelectedCustomShapeIndex(null);
  }, [customShapes]);

  const handleCustomShapeSelect = useCallback((index, e) => {
    e.cancelBubble = true;
    setSelectedCustomShapeIndex(index);
    setSelectedMeasurementLineIndex?.(null);
  }, [setSelectedMeasurementLineIndex]);

  const handleCustomShapeDragEnd = useCallback((index, e) => {
    if (!onCustomShapesChange) return;
    e.cancelBubble = true;
    const deltaX = e.target.x();
    const deltaY = e.target.y();
    if (!deltaX && !deltaY) return;

    const nextShapes = customShapes.map((shape, shapeIndex) => (
      shapeIndex === index
        ? {
          ...shape,
          vertices: shape.vertices.map((vertex) => ({
            x: vertex.x + deltaX,
            y: vertex.y + deltaY
          }))
        }
        : shape
    ));

    e.target.position({ x: 0, y: 0 });
    onCustomShapesChange(nextShapes);
  }, [customShapes, onCustomShapesChange]);

  return {
    selectedCustomShapeIndex,
    setSelectedCustomShapeIndex,
    handleCustomShapeSelect,
    handleCustomShapeDragEnd,
  };
}
