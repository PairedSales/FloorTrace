/**
 * 40 Test Configurations for Thick Wall Detection
 * Comprehensive parameter exploration for detectThickWalls and mergeThickWalls
 */

export const testConfigurations = [
  // BASELINE & VARIATIONS (Tests 1-5)
  {
    name: 'baseline_default',
    description: 'Default recommended settings for thick walls',
    params: {
      // Thick wall detection
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      // Merging
      mergeMaxGap: 50,
      maxGapLength: 100,
      // Preprocessing
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 50
    }
  },
  {
    name: 'thin_walls_focus',
    description: 'Focus on detecting thinner walls (2-15px)',
    params: {
      minWallLength: 40,
      minThickness: 2,
      maxThickness: 15,
      maxParallelSeparation: 20,
      mergeMaxGap: 40,
      maxGapLength: 80,
      adaptiveWindowSize: 13,
      adaptiveC: 1,
      closingKernelSize: 7,
      minFinalLength: 40
    }
  },
  {
    name: 'thick_walls_focus',
    description: 'Focus on detecting thicker walls (15-50px)',
    params: {
      minWallLength: 60,
      minThickness: 15,
      maxThickness: 50,
      maxParallelSeparation: 40,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 11,
      minFinalLength: 60
    }
  },
  {
    name: 'very_thin_lines',
    description: 'Detect very thin lines (1-8px)',
    params: {
      minWallLength: 30,
      minThickness: 1,
      maxThickness: 8,
      maxParallelSeparation: 15,
      mergeMaxGap: 30,
      maxGapLength: 60,
      adaptiveWindowSize: 11,
      adaptiveC: 0,
      closingKernelSize: 5,
      minFinalLength: 30
    }
  },
  {
    name: 'ultra_thick_walls',
    description: 'Detect ultra thick walls (30-80px)',
    params: {
      minWallLength: 80,
      minThickness: 30,
      maxThickness: 80,
      maxParallelSeparation: 60,
      mergeMaxGap: 80,
      maxGapLength: 150,
      adaptiveWindowSize: 21,
      adaptiveC: 5,
      closingKernelSize: 15,
      minFinalLength: 80
    }
  },

  // PARALLEL LINE DETECTION VARIATIONS (Tests 6-10)
  {
    name: 'tight_parallel_detection',
    description: 'Tight parallel line separation (10-20px)',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 20,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 50
    }
  },
  {
    name: 'wide_parallel_detection',
    description: 'Wide parallel line separation (30-50px)',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 50,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 11,
      minFinalLength: 50
    }
  },
  {
    name: 'no_parallel_detection',
    description: 'Disable parallel line detection (solid walls only)',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 4,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 50
    }
  },
  {
    name: 'aggressive_parallel',
    description: 'Very aggressive parallel line detection (up to 70px)',
    params: {
      minWallLength: 60,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 70,
      mergeMaxGap: 80,
      maxGapLength: 150,
      adaptiveWindowSize: 19,
      adaptiveC: 4,
      closingKernelSize: 13,
      minFinalLength: 60
    }
  },
  {
    name: 'moderate_parallel',
    description: 'Moderate parallel detection (25-35px)',
    params: {
      minWallLength: 45,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 35,
      mergeMaxGap: 55,
      maxGapLength: 110,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 45
    }
  },

  // MERGING VARIATIONS (Tests 11-15)
  {
    name: 'no_merging',
    description: 'Minimal merging - keep dashed walls separate',
    params: {
      minWallLength: 40,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 10,
      maxGapLength: 20,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 40
    }
  },
  {
    name: 'aggressive_merging',
    description: 'Aggressive merging - join distant walls',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 100,
      maxGapLength: 200,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 11,
      minFinalLength: 50
    }
  },
  {
    name: 'moderate_merging',
    description: 'Moderate merging for typical dashed walls',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 50
    }
  },
  {
    name: 'extreme_merging',
    description: 'Extreme merging - bridge huge gaps',
    params: {
      minWallLength: 60,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 150,
      maxGapLength: 300,
      adaptiveWindowSize: 19,
      adaptiveC: 4,
      closingKernelSize: 13,
      minFinalLength: 60
    }
  },
  {
    name: 'conservative_merging',
    description: 'Very conservative merging',
    params: {
      minWallLength: 45,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 30,
      maxGapLength: 50,
      adaptiveWindowSize: 13,
      adaptiveC: 2,
      closingKernelSize: 7,
      minFinalLength: 45
    }
  },

  // LENGTH FILTERING (Tests 16-20)
  {
    name: 'short_walls_20px',
    description: 'Allow very short walls (20px minimum)',
    params: {
      minWallLength: 20,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 40,
      maxGapLength: 80,
      adaptiveWindowSize: 13,
      adaptiveC: 2,
      closingKernelSize: 7,
      minFinalLength: 20
    }
  },
  {
    name: 'medium_walls_70px',
    description: 'Medium length walls (70px minimum)',
    params: {
      minWallLength: 70,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 70
    }
  },
  {
    name: 'long_walls_100px',
    description: 'Long walls only (100px minimum)',
    params: {
      minWallLength: 100,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 70,
      maxGapLength: 140,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 11,
      minFinalLength: 100
    }
  },
  {
    name: 'very_long_walls_150px',
    description: 'Very long walls only (150px minimum)',
    params: {
      minWallLength: 150,
      minThickness: 5,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 80,
      maxGapLength: 160,
      adaptiveWindowSize: 19,
      adaptiveC: 3,
      closingKernelSize: 13,
      minFinalLength: 150
    }
  },
  {
    name: 'tiny_features',
    description: 'Detect tiny features (15px minimum)',
    params: {
      minWallLength: 15,
      minThickness: 1,
      maxThickness: 30,
      maxParallelSeparation: 25,
      mergeMaxGap: 30,
      maxGapLength: 60,
      adaptiveWindowSize: 11,
      adaptiveC: 1,
      closingKernelSize: 5,
      minFinalLength: 15
    }
  },

  // PREPROCESSING VARIATIONS (Tests 21-25)
  {
    name: 'small_adaptive_window_9',
    description: 'Small adaptive window for fine details',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 9,
      adaptiveC: 2,
      closingKernelSize: 7,
      minFinalLength: 50
    }
  },
  {
    name: 'large_adaptive_window_25',
    description: 'Large adaptive window for smoothing',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 25,
      adaptiveC: 2,
      closingKernelSize: 11,
      minFinalLength: 50
    }
  },
  {
    name: 'huge_adaptive_window_35',
    description: 'Huge adaptive window for maximum smoothing',
    params: {
      minWallLength: 60,
      minThickness: 5,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 35,
      adaptiveC: 3,
      closingKernelSize: 13,
      minFinalLength: 60
    }
  },
  {
    name: 'low_adaptive_c_0',
    description: 'Zero adaptive C - thinner binary walls',
    params: {
      minWallLength: 50,
      minThickness: 1,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 15,
      adaptiveC: 0,
      closingKernelSize: 7,
      minFinalLength: 50
    }
  },
  {
    name: 'high_adaptive_c_6',
    description: 'High adaptive C - thicker binary walls',
    params: {
      minWallLength: 50,
      minThickness: 5,
      maxThickness: 40,
      maxParallelSeparation: 35,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 17,
      adaptiveC: 6,
      closingKernelSize: 13,
      minFinalLength: 50
    }
  },

  // CLOSING KERNEL VARIATIONS (Tests 26-30)
  {
    name: 'tiny_closing_3',
    description: 'Minimal closing - preserve all gaps',
    params: {
      minWallLength: 40,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 13,
      adaptiveC: 2,
      closingKernelSize: 3,
      minFinalLength: 40
    }
  },
  {
    name: 'small_closing_5',
    description: 'Small closing kernel',
    params: {
      minWallLength: 45,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 13,
      adaptiveC: 2,
      closingKernelSize: 5,
      minFinalLength: 45
    }
  },
  {
    name: 'medium_closing_11',
    description: 'Medium closing kernel',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 11,
      minFinalLength: 50
    }
  },
  {
    name: 'large_closing_17',
    description: 'Large closing - aggressive gap filling',
    params: {
      minWallLength: 55,
      minThickness: 3,
      maxThickness: 35,
      maxParallelSeparation: 35,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 17,
      minFinalLength: 55
    }
  },
  {
    name: 'huge_closing_21',
    description: 'Huge closing - maximum gap filling',
    params: {
      minWallLength: 60,
      minThickness: 5,
      maxThickness: 40,
      maxParallelSeparation: 40,
      mergeMaxGap: 70,
      maxGapLength: 140,
      adaptiveWindowSize: 19,
      adaptiveC: 4,
      closingKernelSize: 21,
      minFinalLength: 60
    }
  },

  // COMBINED STRATEGIES (Tests 31-35)
  {
    name: 'high_recall_strategy',
    description: 'Maximize detection - catch everything',
    params: {
      minWallLength: 25,
      minThickness: 1,
      maxThickness: 50,
      maxParallelSeparation: 50,
      mergeMaxGap: 100,
      maxGapLength: 200,
      adaptiveWindowSize: 19,
      adaptiveC: 4,
      closingKernelSize: 15,
      minFinalLength: 25
    }
  },
  {
    name: 'high_precision_strategy',
    description: 'Maximize quality - only best walls',
    params: {
      minWallLength: 100,
      minThickness: 5,
      maxThickness: 25,
      maxParallelSeparation: 20,
      mergeMaxGap: 40,
      maxGapLength: 80,
      adaptiveWindowSize: 13,
      adaptiveC: 1,
      closingKernelSize: 7,
      minFinalLength: 100
    }
  },
  {
    name: 'balanced_strategy',
    description: 'Balanced recall and precision',
    params: {
      minWallLength: 45,
      minThickness: 2,
      maxThickness: 30,
      maxParallelSeparation: 30,
      mergeMaxGap: 55,
      maxGapLength: 110,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 45
    }
  },
  {
    name: 'fine_detail_strategy',
    description: 'Focus on fine architectural details',
    params: {
      minWallLength: 20,
      minThickness: 1,
      maxThickness: 15,
      maxParallelSeparation: 20,
      mergeMaxGap: 30,
      maxGapLength: 60,
      adaptiveWindowSize: 11,
      adaptiveC: 1,
      closingKernelSize: 5,
      minFinalLength: 20
    }
  },
  {
    name: 'major_structure_strategy',
    description: 'Focus on major structural walls only',
    params: {
      minWallLength: 120,
      minThickness: 10,
      maxThickness: 50,
      maxParallelSeparation: 40,
      mergeMaxGap: 80,
      maxGapLength: 160,
      adaptiveWindowSize: 21,
      adaptiveC: 3,
      closingKernelSize: 13,
      minFinalLength: 120
    }
  },

  // EXTREME & EXPERIMENTAL (Tests 36-40)
  {
    name: 'ultra_permissive',
    description: 'Extremely permissive - detect everything possible',
    params: {
      minWallLength: 10,
      minThickness: 1,
      maxThickness: 100,
      maxParallelSeparation: 80,
      mergeMaxGap: 150,
      maxGapLength: 300,
      adaptiveWindowSize: 21,
      adaptiveC: 6,
      closingKernelSize: 19,
      minFinalLength: 10
    }
  },
  {
    name: 'ultra_strict',
    description: 'Extremely strict - only perfect walls',
    params: {
      minWallLength: 150,
      minThickness: 10,
      maxThickness: 20,
      maxParallelSeparation: 15,
      mergeMaxGap: 30,
      maxGapLength: 50,
      adaptiveWindowSize: 11,
      adaptiveC: 0,
      closingKernelSize: 5,
      minFinalLength: 150
    }
  },
  {
    name: 'variable_thickness_wide',
    description: 'Wide thickness range (2-60px)',
    params: {
      minWallLength: 50,
      minThickness: 2,
      maxThickness: 60,
      maxParallelSeparation: 45,
      mergeMaxGap: 60,
      maxGapLength: 120,
      adaptiveWindowSize: 17,
      adaptiveC: 3,
      closingKernelSize: 11,
      minFinalLength: 50
    }
  },
  {
    name: 'narrow_thickness_range',
    description: 'Narrow thickness range (5-15px)',
    params: {
      minWallLength: 50,
      minThickness: 5,
      maxThickness: 15,
      maxParallelSeparation: 25,
      mergeMaxGap: 50,
      maxGapLength: 100,
      adaptiveWindowSize: 15,
      adaptiveC: 2,
      closingKernelSize: 9,
      minFinalLength: 50
    }
  },
  {
    name: 'optimized_mixed',
    description: 'Optimized mix based on typical floor plans',
    params: {
      minWallLength: 35,
      minThickness: 3,
      maxThickness: 35,
      maxParallelSeparation: 32,
      mergeMaxGap: 65,
      maxGapLength: 130,
      adaptiveWindowSize: 16,
      adaptiveC: 2,
      closingKernelSize: 10,
      minFinalLength: 35
    }
  }
];
