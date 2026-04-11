import React from 'react';
import { Line, Circle, Rect, Text } from 'react-konva';
import { formatLength } from '../../utils/unitConverter';
import { measureSideLenWidth } from './canvasUtils';

const SIDE_LEN_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const SIDE_LEN_FONT_STYLE = '500';

/**
 * PerimeterLayer renders the perimeter polygon outline, draggable vertices,
 * and optional side-length pill labels.
 */
const PerimeterLayer = ({
  perimeterOverlay,
  scale,
  showSideLengths,
  pixelsPerFoot,
  detectedDimensions,
  onVertexDragStart,
  onVertexDrag,
  onVertexDragEnd,
  onDeletePerimeterVertex,
  onDoubleClick,
}) => {
  if (!perimeterOverlay || !perimeterOverlay.vertices) return null;

  return (
    <>
      {/* Perimeter Outline */}
      <Line
        points={perimeterOverlay.vertices.flatMap(v => [v.x, v.y])}
        stroke="#BD93F9"
        strokeWidth={2 / scale}
        closed={true}
        fill="rgba(189, 147, 249, 0.15)"
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
      />

      {/* Perimeter Vertices */}
      {perimeterOverlay.vertices.map((vertex, i) => (
        <React.Fragment key={i}>
          <Circle
            x={vertex.x}
            y={vertex.y}
            radius={5 / scale}
            fill="#BD93F9"
            stroke="#fff"
            strokeWidth={1.5 / scale}
            draggable
            onDragStart={() => onVertexDragStart(i)}
            onDragMove={(e) => onVertexDrag(i, e)}
            onDragEnd={(e) => onVertexDragEnd(i, e)}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (onDeletePerimeterVertex) onDeletePerimeterVertex(i);
            }}
          />
        </React.Fragment>
      ))}

      {/* Side Length Labels */}
      {showSideLengths && pixelsPerFoot && perimeterOverlay.vertices.map((vertex, i) => {
        const nextVertex = perimeterOverlay.vertices[(i + 1) % perimeterOverlay.vertices.length];

        const dx = nextVertex.x - vertex.x;
        const dy = nextVertex.y - vertex.y;
        const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
        const lengthInFeet = lengthInPixels * pixelsPerFoot;
        const formattedLength = formatLength(lengthInFeet, 'decimal');

        const midX = (vertex.x + nextVertex.x) / 2;
        const midY = (vertex.y + nextVertex.y) / 2;

        const angle = Math.atan2(dy, dx);
        const sideSign = i % 2 === 0 ? 1 : -1;
        const shortEdge = lengthInPixels < 48;
        const offsetDistance = sideSign * (shortEdge ? 12 / scale : 9 / scale);
        const offsetX = Math.sin(angle) * offsetDistance;
        const offsetY = -Math.cos(angle) * offsetDistance;

        const ocrRefScreenPx = detectedDimensions && detectedDimensions.length > 0
          ? detectedDimensions.reduce((sum, d) => sum + d.bbox.height, 0) / detectedDimensions.length
          : 14;
        const idealFs = Math.max(14, ocrRefScreenPx) / scale;
        const minFs = 8 / scale;

        const padX = 5 / scale;
        const minW = 30 / scale;
        const maxWByEdge = Math.max(minW, lengthInPixels * 0.9);
        const widthForFs = (fs) => measureSideLenWidth(formattedLength, fs) + padX * 2;

        let fontSize = idealFs;
        if (widthForFs(fontSize) > maxWByEdge) {
          let lo = minFs, hi = fontSize;
          for (let iter = 0; iter < 10; iter++) {
            const mid = (lo + hi) / 2;
            if (widthForFs(mid) > maxWByEdge) hi = mid; else lo = mid;
          }
          fontSize = Math.max(minFs, lo);
        }

        const labelWidth = Math.min(Math.max(minW, widthForFs(fontSize)), maxWByEdge);
        const labelHeight = Math.max(fontSize * 1.5, 16 / scale);
        const cornerR = labelHeight / 2;

        const cx0 = midX + offsetX;
        const cy0 = midY + offsetY;

        const len = lengthInPixels;
        const ex = len > 0 ? dx / len : 1;
        const ey = len > 0 ? dy / len : 0;
        const halfAlong = (labelWidth * Math.abs(ex) + labelHeight * Math.abs(ey)) / 2;
        const vertexClearance = 8 / scale;
        const maxShift = Math.max(0, len / 2 - halfAlong - vertexClearance);

        let edgeShift = 0;
        for (const v of perimeterOverlay.vertices) {
          const pcx = cx0 + edgeShift * ex;
          const pcy = cy0 + edgeShift * ey;
          const nearX = Math.max(pcx - labelWidth / 2, Math.min(v.x, pcx + labelWidth / 2));
          const nearY = Math.max(pcy - labelHeight / 2, Math.min(v.y, pcy + labelHeight / 2));
          const dist2 = (v.x - nearX) ** 2 + (v.y - nearY) ** 2;
          if (dist2 < vertexClearance * vertexClearance) {
            const projEdge = (v.x - pcx) * ex + (v.y - pcy) * ey;
            const required = halfAlong + vertexClearance - Math.abs(projEdge);
            if (required > 0) {
              const dir = projEdge > 0 ? -1 : 1;
              edgeShift = Math.max(-maxShift, Math.min(maxShift, edgeShift + dir * required));
            }
          }
        }

        const finalCx = cx0 + edgeShift * ex;
        const finalCy = cy0 + edgeShift * ey;

        return (
          <React.Fragment key={`label-${i}`}>
            <Rect
              x={finalCx - labelWidth / 2}
              y={finalCy - labelHeight / 2}
              width={labelWidth}
              height={labelHeight}
              fill="rgba(40, 42, 54, 0.92)"
              strokeWidth={0}
              cornerRadius={cornerR}
              listening={false}
            />
            <Text
              x={finalCx - labelWidth / 2}
              y={finalCy - labelHeight / 2}
              width={labelWidth}
              height={labelHeight}
              text={formattedLength}
              fontSize={fontSize}
              fill="#ffffff"
              fontFamily={SIDE_LEN_FONT_FAMILY}
              fontStyle={SIDE_LEN_FONT_STYLE}
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};

export default React.memo(PerimeterLayer);
