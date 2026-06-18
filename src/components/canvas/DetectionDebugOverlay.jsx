import React, { useState, useEffect } from 'react';
import { Group, Line, Circle, Image, Text } from 'react-konva';
import useAppStore from '../../store/appStore';

const COLOR_MAP = {
  interior: '#22D3EE',  // cyan
  exterior: '#818CF8',  // indigo
  rejected: '#EF4444',  // red
  temporary: '#94A3B8', // slate
  final: '#10B981',     // emerald
};

const SELECTION_COLOR = '#F59E0B'; // Amber/Yellow for selected elements

const DetectionDebugOverlay = ({ debugData, scale }) => {
  const selectedGeometryId = useAppStore((s) => s.detectionDebugData?.selectedGeometryId);
  const activeStageIndex = useAppStore((s) => s.detectionDebugData?.activeStageIndex ?? 0);
  const setSelectedGeometryId = useAppStore((s) => s.setSelectedGeometryId);

  // Load mask image
  const activeStage = debugData?.stages?.[activeStageIndex];
  const maskUrl = activeStage?.maskUrl;
  const [maskImage, setMaskImage] = useState(null);

  useEffect(() => {
    if (!maskUrl) {
      setMaskImage(null);
      return;
    }
    const img = new window.Image();
    img.src = maskUrl;
    img.onload = () => setMaskImage(img);
  }, [maskUrl]);

  if (!debugData || !activeStage) return null;

  const geometry = activeStage.geometry || { polygons: [], lines: [], points: [] };
  
  // Get scale details from metadata of first stage if available
  const firstStage = debugData.stages[0];
  const rawWidth = firstStage?.metadata?.['Width'] ? parseInt(firstStage.metadata['Width']) : 0;
  const rawHeight = firstStage?.metadata?.['Height'] ? parseInt(firstStage.metadata['Height']) : 0;
  const scaleFactor = firstStage?.metadata?.['Scale Factor'] ? parseFloat(firstStage.metadata['Scale Factor']) : 1.0;

  // Render sizes mapped back to main canvas image scale
  const maskWidth = rawWidth / scaleFactor;
  const maskHeight = rawHeight / scaleFactor;

  const handleElementClick = (id, e) => {
    e.cancelBubble = true; // prevent canvas click propagation
    setSelectedGeometryId(id === selectedGeometryId ? null : id);
  };

  const handleMouseEnter = (e) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'pointer';
  };

  const handleMouseLeave = (e) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  return (
    <Group listening={true}>
      {/* 1. Mask Image Background */}
      {maskImage && (
        <Image
          image={maskImage}
          x={0}
          y={0}
          width={maskWidth}
          height={maskHeight}
          opacity={0.45}
          listening={false}
        />
      )}

      {/* 2. Polygons */}
      {geometry.polygons?.map((poly) => {
        const pointsArray = poly.points.flatMap((p) => [p.x, p.y]);
        if (pointsArray.length < 4) return null;

        const isSelected = poly.id === selectedGeometryId;
        const color = isSelected ? SELECTION_COLOR : (COLOR_MAP[poly.type] ?? '#FFFFFF');
        const strokeWidth = isSelected ? Math.max(3.5 / scale, 2) : Math.max(2 / scale, 1);
        const dashPattern = poly.type === 'rejected' ? [4 / scale, 4 / scale] : poly.type === 'interior' ? [6 / scale, 4 / scale] : undefined;

        // Find center of polygon for label
        let cx = 0, cy = 0;
        poly.points.forEach((p) => { cx += p.x; cy += p.y; });
        cx /= poly.points.length;
        cy /= poly.points.length;

        return (
          <Group key={poly.id}>
            <Line
              points={pointsArray}
              closed={true}
              stroke={color}
              strokeWidth={strokeWidth}
              dash={dashPattern}
              opacity={isSelected ? 0.95 : 0.65}
              onClick={(e) => handleElementClick(poly.id, e)}
              onTap={(e) => handleElementClick(poly.id, e)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
            {poly.label && !isSelected && (
              <Text
                x={cx}
                y={cy - 6 / scale}
                text={poly.label}
                fontSize={Math.max(11 / scale, 8)}
                fill={color}
                opacity={0.85}
                listening={false}
                align="center"
              />
            )}
          </Group>
        );
      })}

      {/* 3. Lines */}
      {geometry.lines?.map((line) => {
        const isSelected = line.id === selectedGeometryId;
        const color = isSelected ? SELECTION_COLOR : (COLOR_MAP[line.type] ?? '#FFFFFF');
        const strokeWidth = isSelected ? Math.max(4.5 / scale, 2.5) : Math.max(2.5 / scale, 1.5);
        const dashPattern = line.type === 'rejected' ? [2 / scale, 2 / scale] : line.type === 'interior' ? [4 / scale, 3 / scale] : undefined;

        const mx = (line.start.x + line.end.x) / 2;
        const my = (line.start.y + line.end.y) / 2;

        return (
          <Group key={line.id}>
            <Line
              points={[line.start.x, line.start.y, line.end.x, line.end.y]}
              stroke={color}
              strokeWidth={strokeWidth}
              dash={dashPattern}
              opacity={isSelected ? 1.0 : 0.8}
              onClick={(e) => handleElementClick(line.id, e)}
              onTap={(e) => handleElementClick(line.id, e)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
            {line.label && (
              <Text
                x={mx}
                y={my - 12 / scale}
                text={line.label}
                fontSize={Math.max(10 / scale, 7)}
                fill={color}
                opacity={isSelected ? 1.0 : 0.75}
                listening={false}
              />
            )}
          </Group>
        );
      })}

      {/* 4. Points */}
      {geometry.points?.map((pt) => {
        const isSelected = pt.id === selectedGeometryId;
        const color = isSelected ? SELECTION_COLOR : (COLOR_MAP[pt.type] ?? '#FFFFFF');
        const radius = isSelected ? Math.max(7 / scale, 4.5) : Math.max(4.5 / scale, 3);

        return (
          <Group key={pt.id}>
            <Circle
              x={pt.x}
              y={pt.y}
              radius={radius}
              fill={color}
              stroke="#1e293b"
              strokeWidth={Math.max(1 / scale, 0.5)}
              opacity={0.95}
              onClick={(e) => handleElementClick(pt.id, e)}
              onTap={(e) => handleElementClick(pt.id, e)}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
            {pt.label && (
              <Text
                x={pt.x + radius + 3 / scale}
                y={pt.y - 6 / scale}
                text={pt.label}
                fontSize={Math.max(9 / scale, 7.5)}
                fill={color}
                opacity={isSelected ? 1.0 : 0.8}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
};

export default DetectionDebugOverlay;
