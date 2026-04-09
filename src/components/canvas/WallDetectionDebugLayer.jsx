import React from 'react';
import { Layer, Line, Circle, Rect, Text, Group } from 'react-konva';

/**
 * Debug overlay layers for wall detection pipeline.
 *
 * Each layer can be toggled independently via checkboxes rendered
 * in a floating panel (rendered by the parent — see WallDetectionDebugPanel).
 *
 * Props:
 *   debugData       — the `debug` object from runWallDetectionPipeline()
 *   scale           — current canvas/stage scale
 *   enabledLayers   — Set of layer names that are currently visible
 *   pipelineScale   — the pipeline's internal scale (debug.preprocessed.scale)
 */
const WallDetectionDebugLayer = ({ debugData, scale, enabledLayers, pipelineScale }) => {
  if (!debugData) return null;

  const invScale = pipelineScale ? 1 / pipelineScale : 1;
  const sw = 1.5 / scale; // consistent stroke width at any zoom

  return (
    <Layer listening={false}>
      {/* Stage 2: OCR masked regions */}
      {enabledLayers.has('ocrRegions') && debugData.ocrMasking?.ocrRegions?.map((r, i) => (
        <Rect
          key={`ocr-${i}`}
          x={r.x0 * invScale}
          y={r.y0 * invScale}
          width={(r.x1 - r.x0) * invScale}
          height={(r.y1 - r.y0) * invScale}
          fill="rgba(255, 85, 85, 0.25)"
          stroke="#FF5555"
          strokeWidth={sw}
          dash={[4 / scale, 3 / scale]}
        />
      ))}

      {/* Stage 3: Wall candidate segments (horizontal = cyan, vertical = pink) */}
      {enabledLayers.has('wallCandidates') && (
        <>
          {debugData.wallCandidates?.segments?.horizontal?.map((seg, i) => (
            <Line
              key={`wc-h-${i}`}
              points={[seg.x0 * invScale, seg.y0 * invScale, seg.x1 * invScale, seg.y1 * invScale]}
              stroke="rgba(139, 233, 253, 0.6)"
              strokeWidth={sw * 1.5}
            />
          ))}
          {debugData.wallCandidates?.segments?.vertical?.map((seg, i) => (
            <Line
              key={`wc-v-${i}`}
              points={[seg.x0 * invScale, seg.y0 * invScale, seg.x1 * invScale, seg.y1 * invScale]}
              stroke="rgba(255, 121, 198, 0.6)"
              strokeWidth={sw * 1.5}
            />
          ))}
        </>
      )}

      {/* Stage 4: Snapped/merged segments */}
      {enabledLayers.has('mergedSegments') && debugData.structure?.merged?.map((seg, i) => (
        <Line
          key={`ms-${i}`}
          points={[seg.x0 * invScale, seg.y0 * invScale, seg.x1 * invScale, seg.y1 * invScale]}
          stroke="rgba(80, 250, 123, 0.7)"
          strokeWidth={sw * 2}
        />
      ))}

      {/* Stage 4: Graph junctions */}
      {enabledLayers.has('junctions') && debugData.structure?.junctions?.map((j, i) => (
        <Group key={`jn-${i}`}>
          <Circle
            x={j.x * invScale}
            y={j.y * invScale}
            radius={4 / scale}
            fill={j.type === 'L' ? '#F1FA8C' : j.type === 'T' ? '#FFB86C' : '#FF5555'}
            stroke="#282A36"
            strokeWidth={sw * 0.5}
          />
          <Text
            x={j.x * invScale + 5 / scale}
            y={j.y * invScale - 8 / scale}
            text={j.type}
            fontSize={9 / scale}
            fill="#F8F8F2"
          />
        </Group>
      ))}

      {/* Stage 4: Graph nodes */}
      {enabledLayers.has('graphNodes') && debugData.structure?.graph?.nodes?.map((n, i) => (
        <Circle
          key={`gn-${i}`}
          x={n.x * invScale}
          y={n.y * invScale}
          radius={2.5 / scale}
          fill="rgba(189, 147, 249, 0.8)"
        />
      ))}

      {/* Stage 5: Detected room polygons (all regions, faintly) */}
      {enabledLayers.has('roomRegions') && debugData.roomDetection?.regions?.map((r, i) => {
        if (!r.polygon || r.polygon.length < 3) return null;
        const pts = r.polygon.flatMap(p => [p.x * invScale, p.y * invScale]);
        return (
          <Line
            key={`rr-${i}`}
            points={pts}
            closed
            fill="rgba(98, 114, 164, 0.15)"
            stroke="rgba(98, 114, 164, 0.5)"
            strokeWidth={sw}
          />
        );
      })}

      {/* Stage 5: Matched room polygon (bright green) */}
      {enabledLayers.has('roomPolygon') && debugData.roomDetection?.roomPolygon && (
        (() => {
          const pts = debugData.roomDetection.roomPolygon.flatMap(p => [p.x * invScale, p.y * invScale]);
          return (
            <Line
              points={pts}
              closed
              fill="rgba(80, 250, 123, 0.15)"
              stroke="#50FA7B"
              strokeWidth={sw * 2.5}
            />
          );
        })()
      )}

      {/* Stage 6: Exterior perimeter polygon (purple) */}
      {enabledLayers.has('exteriorPerimeter') && debugData.exterior?.polygon && (
        (() => {
          const pts = debugData.exterior.polygon.flatMap(p => [p.x * invScale, p.y * invScale]);
          return (
            <Line
              points={pts}
              closed
              fill="rgba(189, 147, 249, 0.1)"
              stroke="#BD93F9"
              strokeWidth={sw * 2.5}
              dash={[8 / scale, 4 / scale]}
            />
          );
        })()
      )}

      {/* Score labels */}
      {enabledLayers.has('scores') && (
        <Group>
          <Text
            x={10 / scale}
            y={10 / scale}
            text={`Room score: ${(debugData.scoring?.roomScore ?? 0).toFixed(2)}`}
            fontSize={13 / scale}
            fill="#50FA7B"
            fontStyle="bold"
          />
          <Text
            x={10 / scale}
            y={26 / scale}
            text={`Exterior score: ${(debugData.scoring?.exteriorScore ?? 0).toFixed(2)}`}
            fontSize={13 / scale}
            fill="#BD93F9"
            fontStyle="bold"
          />
          <Text
            x={10 / scale}
            y={42 / scale}
            text={`Regions: ${debugData.roomDetection?.regions?.length ?? 0}`}
            fontSize={11 / scale}
            fill="#F8F8F2"
          />
        </Group>
      )}
    </Layer>
  );
};

export default WallDetectionDebugLayer;
