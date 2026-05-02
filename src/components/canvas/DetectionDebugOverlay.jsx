import React from 'react';
import { Group, Line } from 'react-konva';

const EDGE_COLORS = {
  top: '#22D3EE',
  bottom: '#F59E0B',
  left: '#34D399',
  right: '#A78BFA',
};

const profileToPoints = (profile, edge) => {
  if (!Array.isArray(profile)) return [];
  const points = [];

  for (let i = 0; i < profile.length; i += 1) {
    const value = profile[i];
    if (typeof value !== 'number' || value < 0) continue;
    if (edge === 'top' || edge === 'bottom') {
      points.push(i, value);
    } else {
      points.push(value, i);
    }
  }

  return points;
};

const segmentToPoints = (segment) => {
  if (!segment?.start || !segment?.end) return [];
  return [segment.start.x, segment.start.y, segment.end.x, segment.end.y];
};

const DetectionDebugOverlay = ({ debugData, scale }) => {
  if (!debugData) return null;

  const rawProfiles = debugData.edgeProfiles?.raw ?? {};
  const regularizedProfiles = debugData.edgeProfiles?.regularized ?? {};
  const segments = Array.isArray(debugData.correctedEnvelopeSegments)
    ? debugData.correctedEnvelopeSegments
    : [];

  const strokeWidthRaw = Math.max(1 / scale, 0.75);
  const strokeWidthRegularized = Math.max(1.5 / scale, 1);
  const strokeWidthSegments = Math.max(2 / scale, 1.25);

  return (
    <Group listening={false}>
      {Object.entries(rawProfiles).map(([edge, profile]) => {
        const points = profileToPoints(profile, edge);
        if (points.length < 4) return null;
        return (
          <Line
            key={`raw-${edge}`}
            points={points}
            stroke={EDGE_COLORS[edge] ?? '#94A3B8'}
            strokeWidth={strokeWidthRaw}
            opacity={0.35}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}

      {Object.entries(regularizedProfiles).map(([edge, profile]) => {
        const points = profileToPoints(profile, edge);
        if (points.length < 4) return null;
        return (
          <Line
            key={`regularized-${edge}`}
            points={points}
            stroke={EDGE_COLORS[edge] ?? '#CBD5E1'}
            strokeWidth={strokeWidthRegularized}
            opacity={0.75}
            dash={[4 / scale, 3 / scale]}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}

      {segments.map((segment, index) => {
        const points = segmentToPoints(segment);
        if (points.length < 4) return null;
        return (
          <Line
            key={`segment-${segment.edge ?? 'unknown'}-${index}`}
            points={points}
            stroke={EDGE_COLORS[segment.edge] ?? '#FFFFFF'}
            strokeWidth={strokeWidthSegments}
            opacity={0.95}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
    </Group>
  );
};

export default DetectionDebugOverlay;
