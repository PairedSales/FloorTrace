/**
 * useWallTopology.js
 * React hook for orchestrating the complete wall topology analysis workflow
 */

import { useState, useCallback, useRef } from 'react';
import { loadOpenCV, detectSegmentsFromImage, imageToMat, detectSegments } from '../utils/segmentDetection.js';
import { buildTopologyGraph } from '../utils/topologyGraph.js';
import { mergeLines } from '../utils/lineMerging.js';
import { classifyWalls, getWallStatistics } from '../utils/wallClassifier.js';

/**
 * Custom hook for wall topology analysis
 * @param {Object} options - Configuration options
 * @returns {Object} Hook state and methods
 */
export function useWallTopology(options = {}) {
  const {
    // Segment detection options
    cannyLow = 50,
    cannyHigh = 150,
    houghThreshold = 50,
    minLineLength = 30,
    maxLineGap = 10,
    minSegmentLength = 15,
    
    // Topology graph options
    endpointTolerance = 8,
    parallelTolerance = 5,
    
    // Line merging options
    angleTolerance = 5,
    gapTolerance = 8,
    mergeCollinear = true,
    snapEndpoints = true,
    
    // Wall classification options
    minWallLength = 25,
    minConfidence = 0.3,
    filterIsolated = false,
    computeThickness = true,
    mergeParallel = true,
    
    // General options
    autoRun = false
  } = options;
  
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [segments, setSegments] = useState([]);
  const [graph, setGraph] = useState(null);
  const [chains, setChains] = useState([]);
  const [walls, setWalls] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [debugData, setDebugData] = useState(null);
  
  // Refs
  const cvRef = useRef(null);
  const abortRef = useRef(false);
  
  /**
   * Initialize OpenCV
   */
  const initializeOpenCV = useCallback(async () => {
    if (cvRef.current) return cvRef.current;
    
    try {
      cvRef.current = await loadOpenCV();
      return cvRef.current;
    } catch (err) {
      throw new Error(`Failed to load OpenCV: ${err.message}`);
    }
  }, []);
  
  /**
   * Run the complete topology analysis pipeline
   */
  const runTopologyAnalysis = useCallback(async (imageSource) => {
    setIsLoading(true);
    setProgress(0);
    setError(null);
    abortRef.current = false;
    
    try {
      // Step 1: Initialize OpenCV
      setProgress(10);
      const cv = await initializeOpenCV();
      
      if (abortRef.current) return;
      
      // Step 2: Detect segments
      setProgress(20);
      const detectedSegments = await detectSegmentsFromImage(imageSource, {
        cannyLow,
        cannyHigh,
        houghThreshold,
        minLineLength,
        maxLineGap,
        minSegmentLength
      });
      
      if (abortRef.current) return;
      
      setSegments(detectedSegments);
      setProgress(40);
      
      // Step 3: Build topology graph
      setProgress(50);
      const topologyGraph = buildTopologyGraph(detectedSegments, {
        endpointTolerance,
        parallelTolerance,
        collinearTolerance: { angleTolerance, distanceTolerance: 10 }
      });
      
      if (abortRef.current) return;
      
      setGraph(topologyGraph);
      setProgress(60);
      
      // Step 4: Merge lines into chains
      setProgress(70);
      const mergedChains = mergeLines(detectedSegments, topologyGraph, {
        angleTolerance,
        gapTolerance,
        mergeCollinear,
        snapEndpoints
      });
      
      if (abortRef.current) return;
      
      setChains(mergedChains);
      setProgress(80);
      
      // Step 5: Classify walls
      setProgress(90);
      const classifiedWalls = classifyWalls(mergedChains, topologyGraph, {
        minLength: minWallLength,
        minConfidence,
        filterIsolated,
        computeThickness,
        mergeParallel
      });
      
      if (abortRef.current) return;
      
      setWalls(classifiedWalls);
      
      // Step 6: Compute statistics
      const stats = getWallStatistics(classifiedWalls);
      setStatistics(stats);
      
      // Set debug data
      setDebugData({
        segmentCount: detectedSegments.length,
        nodeCount: topologyGraph.nodes.length,
        edgeCount: topologyGraph.edges.length,
        chainCount: mergedChains.length,
        wallCount: classifiedWalls.length,
        junctionCount: topologyGraph.junctions.length,
        parallelPairs: topologyGraph.parallelPairs.length,
        collinearPairs: topologyGraph.collinearPairs.length
      });
      
      setProgress(100);
      setIsLoading(false);
      
      return {
        segments: detectedSegments,
        graph: topologyGraph,
        chains: mergedChains,
        walls: classifiedWalls,
        statistics: stats
      };
      
    } catch (err) {
      console.error('Topology analysis error:', err);
      setError(err.message);
      setIsLoading(false);
      throw err;
    }
  }, [
    cannyLow,
    cannyHigh,
    houghThreshold,
    minLineLength,
    maxLineGap,
    minSegmentLength,
    endpointTolerance,
    parallelTolerance,
    angleTolerance,
    gapTolerance,
    mergeCollinear,
    snapEndpoints,
    minWallLength,
    minConfidence,
    filterIsolated,
    computeThickness,
    mergeParallel,
    initializeOpenCV
  ]);
  
  /**
   * Run analysis on a specific step only
   */
  const runStep = useCallback(async (step, input) => {
    try {
      setIsLoading(true);
      setError(null);
      
      switch (step) {
        case 'detect': {
          const cv = await initializeOpenCV();
          const mat = imageToMat(input, cv);
          const detected = detectSegments(cv, mat, {
            cannyLow,
            cannyHigh,
            houghThreshold,
            minLineLength,
            maxLineGap,
            minSegmentLength
          });
          mat.delete();
          setSegments(detected);
          return detected;
        }
        
        case 'graph': {
          const topologyGraph = buildTopologyGraph(input || segments, {
            endpointTolerance,
            parallelTolerance,
            collinearTolerance: { angleTolerance, distanceTolerance: 10 }
          });
          setGraph(topologyGraph);
          return topologyGraph;
        }
        
        case 'merge': {
          const mergedChains = mergeLines(
            input?.segments || segments,
            input?.graph || graph,
            {
              angleTolerance,
              gapTolerance,
              mergeCollinear,
              snapEndpoints
            }
          );
          setChains(mergedChains);
          return mergedChains;
        }
        
        case 'classify': {
          const classifiedWalls = classifyWalls(
            input?.chains || chains,
            input?.graph || graph,
            {
              minLength: minWallLength,
              minConfidence,
              filterIsolated,
              computeThickness,
              mergeParallel
            }
          );
          setWalls(classifiedWalls);
          const stats = getWallStatistics(classifiedWalls);
          setStatistics(stats);
          return classifiedWalls;
        }
        
        default:
          throw new Error(`Unknown step: ${step}`);
      }
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [
    segments,
    graph,
    chains,
    cannyLow,
    cannyHigh,
    houghThreshold,
    minLineLength,
    maxLineGap,
    minSegmentLength,
    endpointTolerance,
    parallelTolerance,
    angleTolerance,
    gapTolerance,
    mergeCollinear,
    snapEndpoints,
    minWallLength,
    minConfidence,
    filterIsolated,
    computeThickness,
    mergeParallel,
    initializeOpenCV
  ]);
  
  /**
   * Clear all state
   */
  const reset = useCallback(() => {
    setSegments([]);
    setGraph(null);
    setChains([]);
    setWalls([]);
    setStatistics(null);
    setDebugData(null);
    setError(null);
    setProgress(0);
    setIsLoading(false);
  }, []);
  
  /**
   * Abort current analysis
   */
  const abort = useCallback(() => {
    abortRef.current = true;
    setIsLoading(false);
  }, []);
  
  /**
   * Update configuration and optionally re-run
   */
  const updateConfig = useCallback((newConfig, rerun = false) => {
    // This would update the hook's configuration
    // For now, just re-run if requested
    if (rerun && segments.length > 0) {
      // Re-run from graph step with new config
      runStep('graph', segments);
    }
  }, [segments, runStep]);
  
  return {
    // State
    isLoading,
    progress,
    error,
    segments,
    graph,
    chains,
    walls,
    statistics,
    debugData,
    
    // Methods
    runTopologyAnalysis,
    runStep,
    reset,
    abort,
    updateConfig,
    
    // Utilities
    hasResults: walls.length > 0,
    isReady: !isLoading && !error
  };
}

/**
 * Hook variant that auto-runs when image changes
 */
export function useAutoWallTopology(imageSource, options = {}) {
  const hook = useWallTopology(options);
  const prevImageRef = useRef(null);
  
  // Auto-run when image changes
  useState(() => {
    if (imageSource && imageSource !== prevImageRef.current) {
      prevImageRef.current = imageSource;
      hook.runTopologyAnalysis(imageSource);
    }
  }, [imageSource, hook.runTopologyAnalysis]);
  
  return hook;
}

export default useWallTopology;
