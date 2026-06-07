import React, { useRef, useEffect } from 'react';
import { Group, Line, Circle, Arc, Rect, Text } from 'react-konva';
import { getDerivedEndpoints, getAngleLayout, findAngleSnapPointScreen, findVertexNeighbors } from '../../utils/angleMath';
import { measureSideLenWidth } from './canvasUtils';

/**
 * AngleOverlay renders the interactive protractor overlay for angle measurement.
 * Operates in local canvas coordinates but converts to screen space using Konva
 * absolute transforms for snap testing, handle clamping, and visual layout.
 */
const AngleOverlay = ({
  angleToolState,
  onAngleToolStateChange,
  scale,
  canvasRotation,
  perimeterOverlay,
  customShapes,
  measurementLines,
  autoSnapEnabled,
  findVertexSnapPoint,
  onDragStateChange, // Notify parent when dragging to disable stage pan
}) => {
  const groupRef = useRef(null);
  const line1Ref = useRef(null);
  const line2Ref = useRef(null);
  const arcRef = useRef(null);
  const labelBgRef = useRef(null);
  const labelTextRef = useRef(null);
  const centerHandleRef = useRef(null);
  const arm1HandleRef = useRef(null);
  const arm2HandleRef = useRef(null);

  // Local mutable state for high-frequency dragging coordinates
  const coordsRef = useRef({
    center: { x: 0, y: 0 },
    angle1: 0,
    angle2: -Math.PI / 2,
    radius1: 100,
    radius2: 100,
  });

  // Keep track of drag state details to compute deltas
  const dragStartCoordsRef = useRef(null);

  // Updates all Konva nodes imperatively using local coordsRef.current
  const updateVisuals = React.useCallback(() => {
    const { center, angle1, angle2, radius1, radius2 } = coordsRef.current;
    const { p1, p2 } = getDerivedEndpoints(center, angle1, angle2, radius1, radius2);

    // 1. Update line coordinates
    if (line1Ref.current) {
      line1Ref.current.points([center.x, center.y, p1.x, p1.y]);
    }
    if (line2Ref.current) {
      line2Ref.current.points([center.x, center.y, p2.x, p2.y]);
    }

    // 2. Update handle positions
    if (centerHandleRef.current) {
      centerHandleRef.current.position({ x: center.x, y: center.y });
    }
    if (arm1HandleRef.current) {
      arm1HandleRef.current.position({ x: p1.x, y: p1.y });
    }
    if (arm2HandleRef.current) {
      arm2HandleRef.current.position({ x: p2.x, y: p2.y });
    }

    // 3. Update Arc & Label layout
    const arcRadiusScreen = 50; // Visual radius in pixels
    const layout = getAngleLayout(center, angle1, angle2, radius1, radius2, arcRadiusScreen, scale);

    if (arcRef.current) {
      arcRef.current.position({ x: center.x, y: center.y });
      arcRef.current.angle(layout.sweepAngle * 180 / Math.PI);
      arcRef.current.rotation(layout.startAngle * 180 / Math.PI);
      arcRef.current.outerRadius(layout.arcRadiusLocal);
      arcRef.current.innerRadius(0);
      arcRef.current.visible(!layout.hideArc && !layout.isStraight);
    }

    // 4. Update Text label
    if (labelTextRef.current && labelBgRef.current) {
      const angleText = `${layout.angleDeg.toFixed(1)}°`;
      const fontSize = 11 / scale;

      // Update text details
      labelTextRef.current.text(angleText);
      labelTextRef.current.fontSize(fontSize);
      labelTextRef.current.position({ x: layout.labelX, y: layout.labelY });

      // Measure width and height
      const textW = measureSideLenWidth(angleText, fontSize);
      const textH = fontSize * 1.3;
      const padX = 6 / scale;
      const padY = 3 / scale;
      const rectW = textW + padX * 2;
      const rectH = textH + padY * 2;

      // Position pill and center it
      labelTextRef.current.offsetX(rectW / 2 - padX);
      labelTextRef.current.offsetY(rectH / 2 - padY);

      labelBgRef.current.position({ x: layout.labelX, y: layout.labelY });
      labelBgRef.current.width(rectW);
      labelBgRef.current.height(rectH);
      labelBgRef.current.offsetX(rectW / 2);
      labelBgRef.current.offsetY(rectH / 2);
      labelBgRef.current.cornerRadius(rectH / 2);
    }
  }, [scale]);

  // Synchronize state from props (e.g. initial load, undo/redo)
  useEffect(() => {
    if (angleToolState) {
      coordsRef.current = {
        center: { ...angleToolState.center },
        angle1: angleToolState.angle1,
        angle2: angleToolState.angle2,
        radius1: angleToolState.radius1,
        radius2: angleToolState.radius2,
      };
      updateVisuals();
    }
  }, [angleToolState, updateVisuals]);

  // Center handle dragging logic
  const handleCenterDragStart = () => {
    onDragStateChange?.(true);
    dragStartCoordsRef.current = {
      center: { ...coordsRef.current.center },
      angle1: coordsRef.current.angle1,
      angle2: coordsRef.current.angle2,
      radius1: coordsRef.current.radius1,
      radius2: coordsRef.current.radius2,
    };
  };

  const handleCenterDragMove = (e) => {
    const stage = e.target.getStage();
    const layer = e.target.getLayer();
    if (!stage || !layer || !dragStartCoordsRef.current) return;

    // 1. Get raw dragged local position
    const rawCenter = { x: e.target.x(), y: e.target.y() };

    // 2. Snapping (holding shift key bypasses snap)
    const shiftHeld = e.evt && e.evt.shiftKey;
    const snappedPoint = (!shiftHeld && autoSnapEnabled)
      ? findAngleSnapPointScreen(
          rawCenter,
          stage,
          layer,
          perimeterOverlay,
          customShapes,
          measurementLines,
          autoSnapEnabled,
          findVertexSnapPoint
        )
      : null;

    const finalCenter = snappedPoint || rawCenter;

    // Apply back to node position
    e.target.position({ x: finalCenter.x, y: finalCenter.y });

    if (snappedPoint) {
      const neighbors = findVertexNeighbors(
        snappedPoint,
        perimeterOverlay,
        customShapes,
        measurementLines
      );
      if (neighbors && neighbors.length >= 2) {
        const n1 = neighbors[0];
        const n2 = neighbors[1];

        const dx1 = n1.x - snappedPoint.x;
        const dy1 = n1.y - snappedPoint.y;
        const angle1 = Math.atan2(dy1, dx1);
        const radius1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        const dx2 = n2.x - snappedPoint.x;
        const dy2 = n2.y - snappedPoint.y;
        const angle2 = Math.atan2(dy2, dx2);
        const radius2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        coordsRef.current = {
          center: snappedPoint,
          angle1,
          angle2,
          radius1,
          radius2,
        };
      } else if (neighbors && neighbors.length === 1) {
        const n1 = neighbors[0];
        const dx1 = n1.x - snappedPoint.x;
        const dy1 = n1.y - snappedPoint.y;
        const angle1 = Math.atan2(dy1, dx1);
        const radius1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        coordsRef.current = {
          ...dragStartCoordsRef.current,
          center: snappedPoint,
          angle1,
          radius1,
        };
      } else {
        coordsRef.current = {
          ...dragStartCoordsRef.current,
          center: snappedPoint,
        };
      }
    } else {
      coordsRef.current = {
        ...dragStartCoordsRef.current,
        center: finalCenter,
      };
    }

    updateVisuals();
    layer.batchDraw();
  };

  const handleCenterDragEnd = () => {
    onDragStateChange?.(false);
    dragStartCoordsRef.current = null;
    commitState();
  };

  // Arm 1 handle dragging logic
  const handleArm1DragStart = () => {
    onDragStateChange?.(true);
  };

  const handleArm1DragMove = (e) => {
    const stage = e.target.getStage();
    const layer = e.target.getLayer();
    if (!stage || !layer) return;

    const transform = layer.getAbsoluteTransform();
    const screenCenter = transform.point(coordsRef.current.center);

    // Get raw dragged local position
    const rawP1 = { x: e.target.x(), y: e.target.y() };

    // Snap target point (holding shift key bypasses snap)
    const shiftHeld = e.evt && e.evt.shiftKey;
    const snappedPoint = (!shiftHeld && autoSnapEnabled)
      ? findAngleSnapPointScreen(
          rawP1,
          stage,
          layer,
          perimeterOverlay,
          customShapes,
          measurementLines,
          autoSnapEnabled,
          findVertexSnapPoint
        )
      : null;

    const targetP1 = snappedPoint || rawP1;

    // Calculate screen vector from center to target
    const screenTarget = transform.point(targetP1);
    const screenDx = screenTarget.x - screenCenter.x;
    const screenDy = screenTarget.y - screenCenter.y;
    const screenDistance = Math.sqrt(screenDx * screenDx + screenDy * screenDy);

    // Reject snap if too close to center (arm handles cannot snap onto center point)
    // We enforce a minimum length of 25 pixels on screen.
    let finalAngle, finalRadius;
    if (screenDistance < 25) {
      finalAngle = coordsRef.current.angle1; // Keep current angle
      finalRadius = 25 / scale;             // Min length in local space
    } else {
      // Convert snapped screen vector to local canvas values
      const localDx = targetP1.x - coordsRef.current.center.x;
      const localDy = targetP1.y - coordsRef.current.center.y;
      finalAngle = Math.atan2(localDy, localDx);
      finalRadius = Math.sqrt(localDx * localDx + localDy * localDy);
    }

    coordsRef.current.angle1 = finalAngle;
    coordsRef.current.radius1 = finalRadius;

    updateVisuals();
    layer.batchDraw();
  };

  const handleArm1DragEnd = () => {
    onDragStateChange?.(false);
    commitState();
  };

  // Arm 2 handle dragging logic
  const handleArm2DragStart = () => {
    onDragStateChange?.(true);
  };

  const handleArm2DragMove = (e) => {
    const stage = e.target.getStage();
    const layer = e.target.getLayer();
    if (!stage || !layer) return;

    const transform = layer.getAbsoluteTransform();
    const screenCenter = transform.point(coordsRef.current.center);

    // Get raw dragged local position
    const rawP2 = { x: e.target.x(), y: e.target.y() };

    // Snap target point (holding shift key bypasses snap)
    const shiftHeld = e.evt && e.evt.shiftKey;
    const snappedPoint = (!shiftHeld && autoSnapEnabled)
      ? findAngleSnapPointScreen(
          rawP2,
          stage,
          layer,
          perimeterOverlay,
          customShapes,
          measurementLines,
          autoSnapEnabled,
          findVertexSnapPoint
        )
      : null;

    const targetP2 = snappedPoint || rawP2;

    // Calculate screen vector from center to target
    const screenTarget = transform.point(targetP2);
    const screenDx = screenTarget.x - screenCenter.x;
    const screenDy = screenTarget.y - screenCenter.y;
    const screenDistance = Math.sqrt(screenDx * screenDx + screenDy * screenDy);

    // Reject snap if too close to center
    let finalAngle, finalRadius;
    if (screenDistance < 25) {
      finalAngle = coordsRef.current.angle2;
      finalRadius = 25 / scale;
    } else {
      const localDx = targetP2.x - coordsRef.current.center.x;
      const localDy = targetP2.y - coordsRef.current.center.y;
      finalAngle = Math.atan2(localDy, localDx);
      finalRadius = Math.sqrt(localDx * localDx + localDy * localDy);
    }

    coordsRef.current.angle2 = finalAngle;
    coordsRef.current.radius2 = finalRadius;

    updateVisuals();
    layer.batchDraw();
  };

  const handleArm2DragEnd = () => {
    onDragStateChange?.(false);
    commitState();
  };

  // Commit local coordinates back to the global store
  const commitState = () => {
    if (onAngleToolStateChange) {
      onAngleToolStateChange({
        ...angleToolState,
        center: { ...coordsRef.current.center },
        angle1: coordsRef.current.angle1,
        angle2: coordsRef.current.angle2,
        radius1: coordsRef.current.radius1,
        radius2: coordsRef.current.radius2,
      });
    }
  };

  if (!angleToolState) return null;

  const handleStrokeWidth = 2 / scale;
  const borderStrokeWidth = 1 / scale;

  return (
    <Group ref={groupRef}>
      {/* Visual protractor sweep arc */}
      <Arc
        ref={arcRef}
        fill="rgba(139, 233, 253, 0.18)"
        stroke="#8BE9FD"
        strokeWidth={1.2 / scale}
        listening={false}
      />

      {/* Vector arm 1 */}
      <Line
        ref={line1Ref}
        stroke="#BD93F9"
        strokeWidth={handleStrokeWidth}
        dash={[6 / scale, 4 / scale]}
        listening={false}
      />

      {/* Vector arm 2 */}
      <Line
        ref={line2Ref}
        stroke="#BD93F9"
        strokeWidth={handleStrokeWidth}
        dash={[6 / scale, 4 / scale]}
        listening={false}
      />

      {/* Upright Angle Value Pill Label */}
      <Rect
        ref={labelBgRef}
        fill="rgba(40, 42, 54, 0.95)"
        stroke="#BD93F9"
        strokeWidth={borderStrokeWidth}
        rotation={-canvasRotation}
        listening={false}
      />
      <Text
        ref={labelTextRef}
        fill="#50FA7B"
        fontStyle="bold"
        fontFamily="Inter, system-ui, sans-serif"
        align="center"
        verticalAlign="middle"
        rotation={-canvasRotation}
        listening={false}
      />

      {/* Arm 1 Draggable Handle */}
      <Circle
        ref={arm1HandleRef}
        radius={5 / scale}
        fill="#8BE9FD"
        stroke="#ffffff"
        strokeWidth={1.5 / scale}
        draggable
        onDragStart={handleArm1DragStart}
        onDragMove={handleArm1DragMove}
        onDragEnd={handleArm1DragEnd}
      />

      {/* Arm 2 Draggable Handle */}
      <Circle
        ref={arm2HandleRef}
        radius={5 / scale}
        fill="#8BE9FD"
        stroke="#ffffff"
        strokeWidth={1.5 / scale}
        draggable
        onDragStart={handleArm2DragStart}
        onDragMove={handleArm2DragMove}
        onDragEnd={handleArm2DragEnd}
      />

      {/* Center Draggable Handle */}
      <Circle
        ref={centerHandleRef}
        radius={6 / scale}
        fill="#FF79C6"
        stroke="#ffffff"
        strokeWidth={1.5 / scale}
        draggable
        onDragStart={handleCenterDragStart}
        onDragMove={handleCenterDragMove}
        onDragEnd={handleCenterDragEnd}
      />
    </Group>
  );
};

export default React.memo(AngleOverlay);
