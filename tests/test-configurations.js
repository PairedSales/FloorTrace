/**
 * 25 Test Configurations for Wall Detection
 */

export const testConfigurations = [
  {
    name: 'baseline_default',
    description: 'Default recommended settings',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'low_edge_threshold_3pct',
    description: 'Lower edge threshold (3%) for more detection',
    params: {
      edgeThresholdPercent: 3, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.05,
      minLineScore: 0.1, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'very_low_edge_2pct',
    description: 'Very low edge threshold (2%) - maximum detection',
    params: {
      edgeThresholdPercent: 2, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.03,
      minLineScore: 0.08, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'high_edge_threshold_8pct',
    description: 'Higher edge threshold (8%) - cleaner results',
    params: {
      edgeThresholdPercent: 8, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.15,
      minLineScore: 0.2, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'very_high_edge_12pct',
    description: 'Very high edge threshold (12%) - strongest walls only',
    params: {
      edgeThresholdPercent: 12, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 70,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.2,
      minLineScore: 0.25, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'small_closing_5px',
    description: 'Small closing kernel (5px) - preserves gaps',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 5,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'large_closing_15px',
    description: 'Large closing kernel (15px) - aggressive filling',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 15,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'small_merge_gap_30px',
    description: 'Small merge gap (30px) - conservative merging',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 30, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'large_merge_gap_100px',
    description: 'Large merge gap (100px) - aggressive merging',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 100, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'short_walls_30px',
    description: 'Allow short walls (30px) - more complete',
    params: {
      edgeThresholdPercent: 5, minWallLength: 30, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 30,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'long_walls_100px',
    description: 'Long walls only (100px) - cleaner',
    params: {
      edgeThresholdPercent: 5, minWallLength: 100, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 100,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'no_gap_filling',
    description: 'Disable gap filling - solid walls only',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: false, orientationConstraints: true
    }
  },
  {
    name: 'aggressive_gap_200px',
    description: 'Very aggressive gap filling (200px)',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 200, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'small_adaptive_9px',
    description: 'Small adaptive window (9px) - fine details',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 9, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'large_adaptive_25px',
    description: 'Large adaptive window (25px) - smoother',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 25, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'no_orientation_constraints',
    description: 'Allow diagonal walls',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: false
    }
  },
  {
    name: 'high_recall',
    description: 'High recall: low thresholds, aggressive filling',
    params: {
      edgeThresholdPercent: 3, minWallLength: 30, closingKernelSize: 13,
      mergeMaxGap: 80, maxGapLength: 150, minFinalLength: 30,
      adaptiveWindowSize: 15, adaptiveC: 3, minEdgeThreshold: 0.05,
      minLineScore: 0.1, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'high_precision',
    description: 'High precision: strict thresholds',
    params: {
      edgeThresholdPercent: 8, minWallLength: 80, closingKernelSize: 7,
      mergeMaxGap: 40, maxGapLength: 80, minFinalLength: 80,
      adaptiveWindowSize: 15, adaptiveC: 1, minEdgeThreshold: 0.15,
      minLineScore: 0.2, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'balanced',
    description: 'Balanced approach',
    params: {
      edgeThresholdPercent: 4, minWallLength: 40, closingKernelSize: 11,
      mergeMaxGap: 60, maxGapLength: 120, minFinalLength: 40,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.08,
      minLineScore: 0.12, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'low_adaptive_c_0',
    description: 'Low adaptive C (0) - thinner walls',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 0, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'high_adaptive_c_5',
    description: 'High adaptive C (5) - thicker walls',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 5, minEdgeThreshold: 0.1,
      minLineScore: 0.15, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'permissive_line_score_0_05',
    description: 'Very permissive line score (0.05)',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.05, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'strict_line_score_0_3',
    description: 'Strict line score (0.3) - high quality only',
    params: {
      edgeThresholdPercent: 5, minWallLength: 50, closingKernelSize: 9,
      mergeMaxGap: 50, maxGapLength: 100, minFinalLength: 50,
      adaptiveWindowSize: 15, adaptiveC: 2, minEdgeThreshold: 0.1,
      minLineScore: 0.3, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'fine_detail',
    description: 'Fine detail detection',
    params: {
      edgeThresholdPercent: 3, minWallLength: 25, closingKernelSize: 7,
      mergeMaxGap: 40, maxGapLength: 80, minFinalLength: 25,
      adaptiveWindowSize: 11, adaptiveC: 1, minEdgeThreshold: 0.05,
      minLineScore: 0.1, fillGaps: true, orientationConstraints: true
    }
  },
  {
    name: 'major_walls_only',
    description: 'Major walls only - large features',
    params: {
      edgeThresholdPercent: 10, minWallLength: 120, closingKernelSize: 13,
      mergeMaxGap: 70, maxGapLength: 150, minFinalLength: 120,
      adaptiveWindowSize: 21, adaptiveC: 3, minEdgeThreshold: 0.2,
      minLineScore: 0.25, fillGaps: true, orientationConstraints: true
    }
  }
];
