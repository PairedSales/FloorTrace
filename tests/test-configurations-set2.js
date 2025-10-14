/**
 * 25 NEW Test Configurations - Set 2 (Tests 26-50)
 * Wildly varying parameters exploring extreme and unconventional approaches
 */

export const testConfigurations = [
  {
    name: 'ultra_aggressive_detection',
    description: 'Extremely low thresholds - catch everything possible',
    params: {
      edgeThresholdPercent: 1,
      minWallLength: 20,
      closingKernelSize: 17,
      mergeMaxGap: 150,
      maxGapLength: 250,
      minFinalLength: 20,
      adaptiveWindowSize: 19,
      adaptiveC: 7,
      minEdgeThreshold: 0.01,
      minLineScore: 0.03,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'minimal_processing',
    description: 'Bare minimum processing - raw detection',
    params: {
      edgeThresholdPercent: 10,
      minWallLength: 150,
      closingKernelSize: 3,
      mergeMaxGap: 20,
      maxGapLength: 30,
      minFinalLength: 150,
      adaptiveWindowSize: 7,
      adaptiveC: 0,
      minEdgeThreshold: 0.25,
      minLineScore: 0.35,
      fillGaps: false,
      orientationConstraints: true
    }
  },
  {
    name: 'extreme_gap_bridging',
    description: 'Maximum gap filling - connect everything',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 40,
      closingKernelSize: 19,
      mergeMaxGap: 120,
      maxGapLength: 300,
      minFinalLength: 40,
      adaptiveWindowSize: 21,
      adaptiveC: 4,
      minEdgeThreshold: 0.07,
      minLineScore: 0.1,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'tiny_features_only',
    description: 'Focus on very short segments',
    params: {
      edgeThresholdPercent: 2,
      minWallLength: 15,
      closingKernelSize: 5,
      mergeMaxGap: 25,
      maxGapLength: 40,
      minFinalLength: 15,
      adaptiveWindowSize: 9,
      adaptiveC: 1,
      minEdgeThreshold: 0.02,
      minLineScore: 0.05,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'huge_windows',
    description: 'Very large adaptive windows for smoothing',
    params: {
      edgeThresholdPercent: 6,
      minWallLength: 60,
      closingKernelSize: 11,
      mergeMaxGap: 60,
      maxGapLength: 120,
      minFinalLength: 60,
      adaptiveWindowSize: 31,
      adaptiveC: 3,
      minEdgeThreshold: 0.12,
      minLineScore: 0.18,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'negative_adaptive_c',
    description: 'Negative adaptive C for thinner walls',
    params: {
      edgeThresholdPercent: 5,
      minWallLength: 50,
      closingKernelSize: 9,
      mergeMaxGap: 50,
      maxGapLength: 100,
      minFinalLength: 50,
      adaptiveWindowSize: 15,
      adaptiveC: -3,
      minEdgeThreshold: 0.1,
      minLineScore: 0.15,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'ultra_strict',
    description: 'Extremely high thresholds - only perfect walls',
    params: {
      edgeThresholdPercent: 15,
      minWallLength: 150,
      closingKernelSize: 5,
      mergeMaxGap: 30,
      maxGapLength: 50,
      minFinalLength: 150,
      adaptiveWindowSize: 11,
      adaptiveC: 1,
      minEdgeThreshold: 0.3,
      minLineScore: 0.4,
      fillGaps: false,
      orientationConstraints: true
    }
  },
  {
    name: 'no_merging',
    description: 'Disable merging - keep segments separate',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 35,
      closingKernelSize: 9,
      mergeMaxGap: 5,
      maxGapLength: 100,
      minFinalLength: 35,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      minEdgeThreshold: 0.08,
      minLineScore: 0.12,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'diagonal_friendly',
    description: 'Allow all angles - no orientation constraints',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 45,
      closingKernelSize: 9,
      mergeMaxGap: 60,
      maxGapLength: 110,
      minFinalLength: 45,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      minEdgeThreshold: 0.08,
      minLineScore: 0.13,
      fillGaps: true,
      orientationConstraints: false
    }
  },
  {
    name: 'very_small_closing',
    description: 'Minimal closing to preserve all gaps',
    params: {
      edgeThresholdPercent: 3,
      minWallLength: 40,
      closingKernelSize: 3,
      mergeMaxGap: 45,
      maxGapLength: 90,
      minFinalLength: 40,
      adaptiveWindowSize: 13,
      adaptiveC: 2,
      minEdgeThreshold: 0.06,
      minLineScore: 0.11,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'max_adaptive_c',
    description: 'Maximum adaptive C for very thick walls',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 50,
      closingKernelSize: 11,
      mergeMaxGap: 55,
      maxGapLength: 110,
      minFinalLength: 50,
      adaptiveWindowSize: 17,
      adaptiveC: 10,
      minEdgeThreshold: 0.08,
      minLineScore: 0.14,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'ultra_permissive_score',
    description: 'Accept almost any line quality',
    params: {
      edgeThresholdPercent: 3,
      minWallLength: 35,
      closingKernelSize: 9,
      mergeMaxGap: 50,
      maxGapLength: 100,
      minFinalLength: 35,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      minEdgeThreshold: 0.01,
      minLineScore: 0.01,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'mid_range_everything',
    description: 'All parameters at middle values',
    params: {
      edgeThresholdPercent: 6,
      minWallLength: 60,
      closingKernelSize: 11,
      mergeMaxGap: 65,
      maxGapLength: 130,
      minFinalLength: 60,
      adaptiveWindowSize: 17,
      adaptiveC: 2,
      minEdgeThreshold: 0.12,
      minLineScore: 0.17,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'no_gap_no_merge',
    description: 'Disable both gap filling and aggressive merging',
    params: {
      edgeThresholdPercent: 5,
      minWallLength: 55,
      closingKernelSize: 7,
      mergeMaxGap: 10,
      maxGapLength: 50,
      minFinalLength: 55,
      adaptiveWindowSize: 13,
      adaptiveC: 1,
      minEdgeThreshold: 0.1,
      minLineScore: 0.16,
      fillGaps: false,
      orientationConstraints: true
    }
  },
  {
    name: 'asymmetric_approach',
    description: 'High edge threshold but permissive line score',
    params: {
      edgeThresholdPercent: 9,
      minWallLength: 45,
      closingKernelSize: 9,
      mergeMaxGap: 55,
      maxGapLength: 110,
      minFinalLength: 45,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      minEdgeThreshold: 0.18,
      minLineScore: 0.06,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'small_window_high_c',
    description: 'Small adaptive window with high C offset',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 45,
      closingKernelSize: 9,
      mergeMaxGap: 50,
      maxGapLength: 100,
      minFinalLength: 45,
      adaptiveWindowSize: 7,
      adaptiveC: 6,
      minEdgeThreshold: 0.08,
      minLineScore: 0.13,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'large_window_low_c',
    description: 'Large adaptive window with low C offset',
    params: {
      edgeThresholdPercent: 4,
      minWallLength: 45,
      closingKernelSize: 9,
      mergeMaxGap: 50,
      maxGapLength: 100,
      minFinalLength: 45,
      adaptiveWindowSize: 27,
      adaptiveC: -1,
      minEdgeThreshold: 0.08,
      minLineScore: 0.13,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'extreme_length_filter',
    description: 'Only very long walls - filter aggressively',
    params: {
      edgeThresholdPercent: 3,
      minWallLength: 200,
      closingKernelSize: 13,
      mergeMaxGap: 80,
      maxGapLength: 160,
      minFinalLength: 200,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      minEdgeThreshold: 0.06,
      minLineScore: 0.11,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'random_combo_1',
    description: 'Random exploration: loose detection, strict filtering',
    params: {
      edgeThresholdPercent: 2.5,
      minWallLength: 110,
      closingKernelSize: 15,
      mergeMaxGap: 75,
      maxGapLength: 140,
      minFinalLength: 110,
      adaptiveWindowSize: 23,
      adaptiveC: 4,
      minEdgeThreshold: 0.05,
      minLineScore: 0.09,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'random_combo_2',
    description: 'Random exploration: strict detection, loose filtering',
    params: {
      edgeThresholdPercent: 7,
      minWallLength: 28,
      closingKernelSize: 7,
      mergeMaxGap: 90,
      maxGapLength: 180,
      minFinalLength: 28,
      adaptiveWindowSize: 11,
      adaptiveC: 1,
      minEdgeThreshold: 0.14,
      minLineScore: 0.19,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'wild_card_1',
    description: 'Experimental: odd window size, high threshold',
    params: {
      edgeThresholdPercent: 11,
      minWallLength: 65,
      closingKernelSize: 13,
      mergeMaxGap: 45,
      maxGapLength: 85,
      minFinalLength: 65,
      adaptiveWindowSize: 29,
      adaptiveC: 5,
      minEdgeThreshold: 0.22,
      minLineScore: 0.27,
      fillGaps: true,
      orientationConstraints: true
    }
  },
  {
    name: 'wild_card_2',
    description: 'Experimental: tiny closing, huge gaps',
    params: {
      edgeThresholdPercent: 3.5,
      minWallLength: 38,
      closingKernelSize: 5,
      mergeMaxGap: 110,
      maxGapLength: 220,
      minFinalLength: 38,
      adaptiveWindowSize: 19,
      adaptiveC: 3,
      minEdgeThreshold: 0.07,
      minLineScore: 0.11,
      fillGaps: true,
      orientationConstraints: false
    }
  },
  {
    name: 'balanced_no_orient',
    description: 'Balanced parameters but allow diagonals',
    params: {
      edgeThresholdPercent: 4.5,
      minWallLength: 48,
      closingKernelSize: 10,
      mergeMaxGap: 58,
      maxGapLength: 115,
      minFinalLength: 48,
      adaptiveWindowSize: 16,
      adaptiveC: 2,
      minEdgeThreshold: 0.09,
      minLineScore: 0.14,
      fillGaps: true,
      orientationConstraints: false
    }
  },
  {
    name: 'precision_over_recall',
    description: 'Favor quality over quantity',
    params: {
      edgeThresholdPercent: 8.5,
      minWallLength: 90,
      closingKernelSize: 7,
      mergeMaxGap: 35,
      maxGapLength: 70,
      minFinalLength: 90,
      adaptiveWindowSize: 13,
      adaptiveC: 1,
      minEdgeThreshold: 0.17,
      minLineScore: 0.23,
      fillGaps: false,
      orientationConstraints: true
    }
  },
  {
    name: 'recall_over_precision',
    description: 'Favor quantity over quality',
    params: {
      edgeThresholdPercent: 1.5,
      minWallLength: 22,
      closingKernelSize: 15,
      mergeMaxGap: 95,
      maxGapLength: 190,
      minFinalLength: 22,
      adaptiveWindowSize: 19,
      adaptiveC: 5,
      minEdgeThreshold: 0.03,
      minLineScore: 0.04,
      fillGaps: true,
      orientationConstraints: true
    }
  }
];
