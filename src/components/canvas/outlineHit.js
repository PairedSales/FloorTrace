// Which outline a gesture on the plan is about.
//
// Every visible outline can be edited where it stands — its corners are all
// handles — so a gesture that does not start on a handle (a double-click on a
// wall, a brush stroke over some corners) has to work out which outline it
// meant. The answer is where the gesture landed, never which outline happens
// to be in hand (the owner's decision, October 2026). The outline in hand only
// settles what position cannot: outlines often share a wall or a corner (a
// garage against the house), and there the gesture is equally on both.
//
// Imports only `canvasUtils`, which pulls no konva into the graph.
import { pointToLineDistance } from './canvasUtils';

const editable = (trace, minCorners) => !!trace?.visible && (trace.vertices?.length ?? 0) >= minCorners;

/**
 * The wall nearest a point, over every visible outline. The outline in hand
 * wins an exact tie and nothing else.
 *
 * @returns {{traceId: string, edgeIndex: number, distance: number}|null}
 *   `edgeIndex` is the corner the wall starts at
 */
export function nearestOutlineEdge(traces, activeTraceId, point) {
  let best = null;
  for (const trace of traces ?? []) {
    if (!editable(trace, 3)) continue;
    const { vertices } = trace;
    const inHand = trace.id === activeTraceId;
    for (let i = 0; i < vertices.length; i += 1) {
      const distance = pointToLineDistance(point, vertices[i], vertices[(i + 1) % vertices.length]);
      if (!best || distance < best.distance
        || (inHand && best.traceId !== trace.id && distance === best.distance)) {
        best = { traceId: trace.id, edgeIndex: i, distance };
      }
    }
  }
  return best;
}

const distanceToPath = (vertex, path) => {
  if (path.length === 1) return Math.hypot(vertex.x - path[0].x, vertex.y - path[0].y);
  let min = Infinity;
  for (let j = 0; j < path.length - 1; j += 1) {
    const d = pointToLineDistance(vertex, path[j], path[j + 1]);
    if (d < min) min = d;
  }
  return min;
};

/**
 * What a stroke of the corner eraser takes off, and from which outline.
 *
 * One outline per stroke: the one whose corner the brush passed closest to,
 * the outline in hand winning an exact tie (a corner two outlines share).
 * Never below three corners — the nearest are taken first and the rest are
 * left.
 *
 * @returns {{traceId: string, vertices: {x:number,y:number}[]}|null} the
 *   outline as it is after the stroke, or null when the brush touched nothing
 *   it may remove
 */
export function eraseCornersUnderStroke(traces, activeTraceId, path, radius) {
  if (!path?.length) return null;
  let target = null;
  for (const trace of traces ?? []) {
    // An outline of three corners has none to spare.
    if (!editable(trace, 4)) continue;
    const hits = [];
    for (let i = 0; i < trace.vertices.length; i += 1) {
      const distance = distanceToPath(trace.vertices[i], path);
      if (distance <= radius) hits.push({ index: i, distance });
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.distance - b.distance);
    const nearest = hits[0].distance;
    if (!target || nearest < target.hits[0].distance
      || (trace.id === activeTraceId && nearest === target.hits[0].distance)) {
      target = { trace, hits };
    }
  }
  if (!target) return null;

  const { trace, hits } = target;
  const remove = new Set(hits.slice(0, trace.vertices.length - 3).map((h) => h.index));
  return {
    traceId: trace.id,
    vertices: trace.vertices.filter((_, index) => !remove.has(index)),
  };
}
