/**
 * WallGraphOverlay.jsx
 * React-Konva visualization of wall topology analysis
 */

import React, { useState } from 'react';
import { Layer, Line, Circle, Group, Text } from 'react-konva';

/**
 * Wall Graph Overlay Component
 * Renders detected segments, merged walls, junctions, and topology graph
 */
export function WallGraphOverlay({
  segments = [],
  walls = [],
  graph = null,
  chains = [],
  showSegments = false,
  showWalls = true,
  showNodes = false,
  showJunctions = true,
  showLabels = false,
  opacity = 0.9,
  onWallClick = null,
  selectedWallId = null
}) {
  const [hoveredWall, setHoveredWall] = useState(null);
  
  return (
    <Layer>
      {/* Original detected segments (thin gray lines) */}
      {showSegments && segments.map((seg, idx) => (
        <Line
          key={`seg-${idx}`}
          points={[seg.x1, seg.y1, seg.x2, seg.y2]}
          stroke="rgba(128, 128, 128, 0.3)"
          strokeWidth={1}
          listening={false}
        />
      ))}
      
      {/* Merged wall chains (bold lines) */}
      {showWalls && walls.map((wall) => {
        const isSelected = selectedWallId === wall.id;
        const isHovered = hoveredWall === wall.id;
        
        return (
          <Group key={wall.id}>
            <Line
              points={[wall.chain.x1, wall.chain.y1, wall.chain.x2, wall.chain.y2]}
              stroke={getWallColor(wall, isSelected, isHovered)}
              strokeWidth={getWallStrokeWidth(wall, isSelected, isHovered)}
              opacity={opacity}
              shadowBlur={isHovered ? 10 : 0}
              shadowColor={isSelected ? 'cyan' : 'white'}
              listening={true}
              onClick={() => onWallClick && onWallClick(wall)}
              onMouseEnter={() => setHoveredWall(wall.id)}
              onMouseLeave={() => setHoveredWall(null)}
            />
            
            {/* Wall label */}
            {showLabels && (
              <Text
                x={(wall.chain.x1 + wall.chain.x2) / 2}
                y={(wall.chain.y1 + wall.chain.y2) / 2 - 10}
                text={`${wall.id} (${Math.round(wall.length)}px)`}
                fontSize={10}
                fill="white"
                stroke="black"
                strokeWidth={0.5}
                listening={false}
              />
            )}
          </Group>
        );
      })}
      
      {/* Graph nodes (connection points) */}
      {showNodes && graph && graph.nodes.map((node) => (
        <Circle
          key={`node-${node.id}`}
          x={node.x}
          y={node.y}
          radius={3}
          fill="rgba(100, 149, 237, 0.6)"
          stroke="white"
          strokeWidth={1}
          listening={false}
        />
      ))}
      
      {/* Junction points (where walls meet) */}
      {showJunctions && graph && graph.junctions.map((junction, idx) => (
        <Circle
          key={`junction-${idx}`}
          x={junction.x}
          y={junction.y}
          radius={getJunctionRadius(junction)}
          fill={getJunctionColor(junction)}
          stroke="white"
          strokeWidth={1.5}
          opacity={0.8}
          listening={false}
        />
      ))}
    </Layer>
  );
}

/**
 * Get wall color based on properties and state
 */
function getWallColor(wall, isSelected, isHovered) {
  if (isSelected) return 'cyan';
  if (isHovered) return 'yellow';
  
  // Color by orientation
  switch (wall.orientation) {
    case 'horizontal':
      return 'rgba(100, 149, 237, 0.9)'; // Cornflower blue
    case 'vertical':
      return 'rgba(255, 99, 71, 0.9)';   // Tomato
    case 'diagonal':
      return 'rgba(152, 251, 152, 0.9)'; // Pale green
    default:
      return 'white';
  }
}

/**
 * Get wall stroke width based on properties
 */
function getWallStrokeWidth(wall, isSelected, isHovered) {
  let base = wall.thickness || 3;
  
  if (isSelected) return base + 3;
  if (isHovered) return base + 2;
  
  // Adjust by quality
  if (wall.quality > 0.7) return base + 1;
  
  return base;
}

/**
 * Get junction color based on type
 */
function getJunctionColor(junction) {
  switch (junction.type) {
    case 'multi':
      return 'red';
    case 'corner':
      return 'orange';
    case 'collinear':
      return 'yellow';
    default:
      return 'blue';
  }
}

/**
 * Get junction radius based on degree
 */
function getJunctionRadius(junction) {
  return Math.min(3 + junction.degree, 8);
}

/**
 * Debug overlay showing all topology information
 */
export function DebugTopologyOverlay({
  segments = [],
  graph = null,
  showEdges = true,
  showNodes = true,
  showNodeLabels = true
}) {
  if (!graph) return null;
  
  return (
    <Layer>
      {/* Graph edges (segment connections) */}
      {showEdges && graph.edges.map((edge, idx) => {
        const startNode = graph.nodes[edge.startNode];
        const endNode = graph.nodes[edge.endNode];
        
        return (
          <Line
            key={`edge-${idx}`}
            points={[startNode.x, startNode.y, endNode.x, endNode.y]}
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth={1}
            dash={[5, 5]}
            listening={false}
          />
        );
      })}
      
      {/* Nodes */}
      {showNodes && graph.nodes.map((node) => (
        <Group key={`debug-node-${node.id}`}>
          <Circle
            x={node.x}
            y={node.y}
            radius={4}
            fill="lime"
            stroke="black"
            strokeWidth={1}
            listening={false}
          />
          
          {showNodeLabels && (
            <Text
              x={node.x + 6}
              y={node.y - 6}
              text={`N${node.id}`}
              fontSize={8}
              fill="lime"
              listening={false}
            />
          )}
        </Group>
      ))}
      
      {/* Parallel pairs */}
      {graph.parallelPairs && graph.parallelPairs.slice(0, 10).map((pair, idx) => {
        const seg1 = segments[pair.seg1];
        const seg2 = segments[pair.seg2];
        
        if (!seg1 || !seg2) return null;
        
        const mid1 = { x: (seg1.x1 + seg1.x2) / 2, y: (seg1.y1 + seg1.y2) / 2 };
        const mid2 = { x: (seg2.x1 + seg2.x2) / 2, y: (seg2.y1 + seg2.y2) / 2 };
        
        return (
          <Line
            key={`parallel-${idx}`}
            points={[mid1.x, mid1.y, mid2.x, mid2.y]}
            stroke="rgba(255, 165, 0, 0.3)"
            strokeWidth={1}
            dash={[3, 3]}
            listening={false}
          />
        );
      })}
    </Layer>
  );
}

/**
 * Statistics overlay panel
 */
export function TopologyStatsPanel({ statistics, debugData, className = '' }) {
  if (!statistics && !debugData) return null;
  
  return (
    <div className={`bg-black bg-opacity-75 text-white p-4 rounded-lg ${className}`}>
      <h3 className="text-lg font-bold mb-2">Topology Analysis</h3>
      
      {debugData && (
        <div className="mb-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>Segments:</div>
            <div className="font-mono">{debugData.segmentCount}</div>
            
            <div>Nodes:</div>
            <div className="font-mono">{debugData.nodeCount}</div>
            
            <div>Edges:</div>
            <div className="font-mono">{debugData.edgeCount}</div>
            
            <div>Chains:</div>
            <div className="font-mono">{debugData.chainCount}</div>
            
            <div>Walls:</div>
            <div className="font-mono">{debugData.wallCount}</div>
            
            <div>Junctions:</div>
            <div className="font-mono">{debugData.junctionCount}</div>
          </div>
        </div>
      )}
      
      {statistics && (
        <div className="text-sm">
          <h4 className="font-semibold mb-1">Wall Statistics</h4>
          
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>Total Length:</div>
            <div className="font-mono">{Math.round(statistics.totalLength)}px</div>
            
            <div>Avg Length:</div>
            <div className="font-mono">{Math.round(statistics.avgLength)}px</div>
            
            <div>Avg Confidence:</div>
            <div className="font-mono">{(statistics.avgConfidence * 100).toFixed(1)}%</div>
          </div>
          
          {statistics.orientations && (
            <div className="mb-2">
              <h5 className="font-semibold text-xs mb-1">Orientations</h5>
              {Object.entries(statistics.orientations).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="capitalize">{key}:</span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
          
          {statistics.types && (
            <div>
              <h5 className="font-semibold text-xs mb-1">Types</h5>
              {Object.entries(statistics.types).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="capitalize">{key}:</span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Control panel for toggling visualization options
 */
export function TopologyControlPanel({ config, onChange, className = '' }) {
  const toggleOption = (key) => {
    onChange({ ...config, [key]: !config[key] });
  };
  
  return (
    <div className={`bg-black bg-opacity-75 text-white p-4 rounded-lg ${className}`}>
      <h3 className="text-lg font-bold mb-3">Visualization</h3>
      
      <div className="space-y-2">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.showSegments || false}
            onChange={() => toggleOption('showSegments')}
            className="form-checkbox h-4 w-4"
          />
          <span className="text-sm">Show Segments</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.showWalls !== false}
            onChange={() => toggleOption('showWalls')}
            className="form-checkbox h-4 w-4"
          />
          <span className="text-sm">Show Walls</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.showNodes || false}
            onChange={() => toggleOption('showNodes')}
            className="form-checkbox h-4 w-4"
          />
          <span className="text-sm">Show Nodes</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.showJunctions !== false}
            onChange={() => toggleOption('showJunctions')}
            className="form-checkbox h-4 w-4"
          />
          <span className="text-sm">Show Junctions</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.showLabels || false}
            onChange={() => toggleOption('showLabels')}
            className="form-checkbox h-4 w-4"
          />
          <span className="text-sm">Show Labels</span>
        </label>
        
        <div className="pt-2">
          <label className="text-sm block mb-1">Opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={config.opacity || 0.9}
            onChange={(e) => onChange({ ...config, opacity: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Wall detail panel showing selected wall information
 */
export function WallDetailPanel({ wall, onClose, className = '' }) {
  if (!wall) return null;
  
  return (
    <div className={`bg-black bg-opacity-90 text-white p-4 rounded-lg ${className}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-bold">{wall.id}</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-gray-400">Length:</div>
          <div className="font-mono">{Math.round(wall.length)}px</div>
          
          <div className="text-gray-400">Orientation:</div>
          <div className="capitalize">{wall.orientation}</div>
          
          <div className="text-gray-400">Type:</div>
          <div className="capitalize">{wall.type}</div>
          
          <div className="text-gray-400">Confidence:</div>
          <div className="font-mono">{(wall.confidence * 100).toFixed(1)}%</div>
          
          {wall.quality !== undefined && (
            <>
              <div className="text-gray-400">Quality:</div>
              <div className="font-mono">{(wall.quality * 100).toFixed(1)}%</div>
            </>
          )}
          
          <div className="text-gray-400">Segments:</div>
          <div className="font-mono">{wall.segmentCount}</div>
          
          {wall.thickness !== undefined && (
            <>
              <div className="text-gray-400">Thickness:</div>
              <div className="font-mono">{wall.thickness.toFixed(1)}px</div>
            </>
          )}
          
          {wall.connectivityDegree !== undefined && (
            <>
              <div className="text-gray-400">Connections:</div>
              <div className="font-mono">{wall.connectivityDegree}</div>
            </>
          )}
        </div>
        
        <div className="pt-2 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Coordinates:</div>
          <div className="font-mono text-xs">
            ({Math.round(wall.chain.x1)}, {Math.round(wall.chain.y1)}) →
            ({Math.round(wall.chain.x2)}, {Math.round(wall.chain.y2)})
          </div>
        </div>
      </div>
    </div>
  );
}

export default WallGraphOverlay;
