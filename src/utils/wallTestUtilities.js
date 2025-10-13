/**
 * Wall Detection Testing Utilities
 * 
 * Comprehensive testing framework for the hybrid wall detection system.
 * Provides validation, assertions, metrics collection, and detailed logging
 * for each stage of the pipeline.
 */

/**
 * Test result status
 */
export const TestStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  WARNING: 'warning'
};

/**
 * Test assertion class
 */
export class TestAssertion {
  constructor(name, condition, expected, actual, message = '') {
    this.name = name;
    this.condition = condition;
    this.expected = expected;
    this.actual = actual;
    this.message = message;
    this.passed = condition;
  }
}

/**
 * Test step result
 */
export class TestStepResult {
  constructor(stepName, stepNumber) {
    this.stepName = stepName;
    this.stepNumber = stepNumber;
    this.status = TestStatus.PENDING;
    this.startTime = null;
    this.endTime = null;
    this.duration = null;
    this.input = null;
    this.output = null;
    this.metrics = {};
    this.assertions = [];
    this.warnings = [];
    this.errors = [];
    this.visualizations = {};
  }

  start() {
    this.status = TestStatus.RUNNING;
    this.startTime = performance.now();
  }

  finish(output) {
    this.endTime = performance.now();
    this.duration = this.endTime - this.startTime;
    this.output = output;
    
    // Determine status based on assertions
    if (this.errors.length > 0) {
      this.status = TestStatus.FAILED;
    } else if (this.assertions.some(a => !a.passed)) {
      this.status = TestStatus.FAILED;
    } else if (this.warnings.length > 0) {
      this.status = TestStatus.WARNING;
    } else {
      this.status = TestStatus.PASSED;
    }
  }

  addMetric(name, value, unit = '') {
    this.metrics[name] = { value, unit };
  }

  addAssertion(assertion) {
    this.assertions.push(assertion);
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  addError(error) {
    this.errors.push(error);
  }

  addVisualization(name, dataUrl) {
    this.visualizations[name] = dataUrl;
  }
}

/**
 * Complete test suite result
 */
export class TestSuiteResult {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.startTime = performance.now();
    this.endTime = null;
    this.duration = null;
    this.steps = [];
    this.overallStatus = TestStatus.RUNNING;
  }

  addStep(stepResult) {
    this.steps.push(stepResult);
  }

  finish() {
    this.endTime = performance.now();
    this.duration = this.endTime - this.startTime;
    
    // Determine overall status
    const hasFailures = this.steps.some(s => s.status === TestStatus.FAILED);
    const hasWarnings = this.steps.some(s => s.status === TestStatus.WARNING);
    
    if (hasFailures) {
      this.overallStatus = TestStatus.FAILED;
    } else if (hasWarnings) {
      this.overallStatus = TestStatus.WARNING;
    } else {
      this.overallStatus = TestStatus.PASSED;
    }
  }

  getSummary() {
    const totalSteps = this.steps.length;
    const passed = this.steps.filter(s => s.status === TestStatus.PASSED).length;
    const failed = this.steps.filter(s => s.status === TestStatus.FAILED).length;
    const warnings = this.steps.filter(s => s.status === TestStatus.WARNING).length;
    
    return {
      totalSteps,
      passed,
      failed,
      warnings,
      successRate: (passed / totalSteps * 100).toFixed(1),
      totalDuration: this.duration,
      overallStatus: this.overallStatus
    };
  }
}

/**
 * Validators for each pipeline stage
 */
export const Validators = {
  /**
   * Validate preprocessing output
   */
  validatePreprocessing(result, imageData) {
    const assertions = [];
    const width = imageData.width;
    const height = imageData.height;
    
    // Check that grayscale was generated
    assertions.push(new TestAssertion(
      'Grayscale generation',
      result.grayscale && result.grayscale.length === width * height,
      width * height,
      result.grayscale?.length || 0,
      'Grayscale array should match image dimensions'
    ));
    
    // Check that binary was generated
    assertions.push(new TestAssertion(
      'Binary generation',
      result.binary && result.binary.length === width * height,
      width * height,
      result.binary?.length || 0,
      'Binary array should match image dimensions'
    ));
    
    // Check binary values are 0 or 1
    const validBinary = result.binary && Array.from(result.binary).every(v => v === 0 || v === 1);
    assertions.push(new TestAssertion(
      'Binary values valid',
      validBinary,
      'All values 0 or 1',
      validBinary ? 'Valid' : 'Invalid',
      'Binary array should only contain 0 or 1'
    ));
    
    // Calculate wall pixel ratio
    if (result.binary) {
      const wallPixels = Array.from(result.binary).filter(v => v === 1).length;
      const wallRatio = (wallPixels / result.binary.length * 100).toFixed(2);
      
      // Wall pixels should be reasonable (typically 5-30% for floor plans)
      const reasonableRatio = wallRatio >= 2 && wallRatio <= 40;
      assertions.push(new TestAssertion(
        'Wall pixel ratio',
        reasonableRatio,
        '2-40%',
        `${wallRatio}%`,
        'Wall pixels should be 2-40% of total image'
      ));
    }
    
    return assertions;
  },

  /**
   * Validate segmentation output
   */
  validateSegmentation(likelihood, width, height) {
    const assertions = [];
    
    // Check likelihood map size
    assertions.push(new TestAssertion(
      'Likelihood map size',
      likelihood.length === width * height,
      width * height,
      likelihood.length,
      'Likelihood map should match image dimensions'
    ));
    
    // Check likelihood values are in [0, 1]
    const validRange = Array.from(likelihood).every(v => v >= 0 && v <= 1);
    assertions.push(new TestAssertion(
      'Likelihood values in range',
      validRange,
      '[0, 1]',
      validRange ? 'Valid' : 'Invalid',
      'Likelihood values should be between 0 and 1'
    ));
    
    // Check that there are some high-likelihood pixels
    const highLikelihood = Array.from(likelihood).filter(v => v > 0.5).length;
    const hasContent = highLikelihood > 0;
    assertions.push(new TestAssertion(
      'High likelihood pixels exist',
      hasContent,
      '> 0',
      highLikelihood,
      'Should have some high-likelihood wall pixels'
    ));
    
    return assertions;
  },

  /**
   * Validate line detection output
   */
  validateLineDetection(segments, minLength) {
    const assertions = [];
    
    // Check segments were detected
    assertions.push(new TestAssertion(
      'Segments detected',
      segments.length > 0,
      '> 0',
      segments.length,
      'Should detect at least some line segments'
    ));
    
    // Check all segments meet minimum length
    const validLengths = segments.every(s => s.length >= minLength);
    assertions.push(new TestAssertion(
      'Minimum length requirement',
      validLengths,
      `>= ${minLength}px`,
      validLengths ? 'All valid' : 'Some invalid',
      `All segments should be at least ${minLength}px long`
    ));
    
    // Check segments have valid coordinates
    const validCoords = segments.every(s => 
      !isNaN(s.x1) && !isNaN(s.y1) && !isNaN(s.x2) && !isNaN(s.y2)
    );
    assertions.push(new TestAssertion(
      'Valid coordinates',
      validCoords,
      'All valid',
      validCoords ? 'Valid' : 'Invalid',
      'All segments should have valid numeric coordinates'
    ));
    
    return assertions;
  },

  /**
   * Validate gap filling output
   */
  validateGapFilling(beforeSegments, afterSegments) {
    const assertions = [];
    
    // Gap filling should not create segments
    const notIncreased = afterSegments.length <= beforeSegments.length;
    assertions.push(new TestAssertion(
      'Segment count reasonable',
      notIncreased,
      `<= ${beforeSegments.length}`,
      afterSegments.length,
      'Gap filling should merge, not create segments'
    ));
    
    // Should not remove all segments
    assertions.push(new TestAssertion(
      'Segments remain',
      afterSegments.length > 0,
      '> 0',
      afterSegments.length,
      'Should still have segments after gap filling'
    ));
    
    return assertions;
  },

  /**
   * Validate post-processing output
   */
  validatePostProcessing(processed) {
    const assertions = [];
    
    // Check all required arrays exist
    const hasAll = processed.all && processed.horizontal && processed.vertical;
    assertions.push(new TestAssertion(
      'Required arrays exist',
      hasAll,
      'all, horizontal, vertical',
      hasAll ? 'Present' : 'Missing',
      'Should have all required segment arrays'
    ));
    
    // Check horizontal + vertical = all (approximately)
    if (hasAll) {
      const sum = processed.horizontal.length + processed.vertical.length;
      const matchesAll = Math.abs(sum - processed.all.length) <= 5;
      assertions.push(new TestAssertion(
        'Orientation classification complete',
        matchesAll,
        processed.all.length,
        sum,
        'Horizontal + vertical should approximately equal all segments'
      ));
    }
    
    // Check exterior/interior classification
    if (processed.exterior && processed.interior) {
      const hasExterior = processed.exterior.length > 0;
      assertions.push(new TestAssertion(
        'Exterior walls detected',
        hasExterior,
        '> 0',
        processed.exterior.length,
        'Should detect some exterior walls'
      ));
    }
    
    return assertions;
  },

  /**
   * Validate perimeter building
   */
  validatePerimeter(perimeter, imageWidth, imageHeight) {
    const assertions = [];
    
    if (!perimeter) {
      assertions.push(new TestAssertion(
        'Perimeter exists',
        false,
        'Present',
        'null',
        'Perimeter should be built'
      ));
      return assertions;
    }
    
    // Check vertices exist
    const hasVertices = perimeter.vertices && perimeter.vertices.length >= 4;
    assertions.push(new TestAssertion(
      'Sufficient vertices',
      hasVertices,
      '>= 4',
      perimeter.vertices?.length || 0,
      'Perimeter should have at least 4 vertices'
    ));
    
    // Check vertices are within image bounds
    if (perimeter.vertices) {
      const inBounds = perimeter.vertices.every(v => 
        v.x >= 0 && v.x <= imageWidth && v.y >= 0 && v.y <= imageHeight
      );
      assertions.push(new TestAssertion(
        'Vertices in bounds',
        inBounds,
        'All in bounds',
        inBounds ? 'Valid' : 'Invalid',
        'All vertices should be within image bounds'
      ));
    }
    
    return assertions;
  },

  /**
   * Validate room finding
   */
  validateRoomFinding(wallData, dimensions, rooms) {
    const assertions = [];
    
    // Check that rooms were found for dimensions
    const roomsFound = rooms.filter(r => r !== null).length;
    const successRate = dimensions.length > 0 ? (roomsFound / dimensions.length * 100).toFixed(1) : 0;
    
    assertions.push(new TestAssertion(
      'Rooms found',
      roomsFound > 0,
      '> 0',
      roomsFound,
      'Should find at least one room'
    ));
    
    // Check room success rate
    const goodSuccessRate = dimensions.length === 0 || successRate >= 50;
    assertions.push(new TestAssertion(
      'Room finding success rate',
      goodSuccessRate,
      '>= 50%',
      `${successRate}%`,
      'Should successfully find at least 50% of rooms'
    ));
    
    return assertions;
  }
};

/**
 * Metrics calculators
 */
export const MetricsCalculators = {
  /**
   * Calculate preprocessing metrics
   */
  preprocessingMetrics(result) {
    const metrics = {};
    
    if (result.binary) {
      let wallPixels = 0;
      for (let i = 0; i < result.binary.length; i++) {
        if (result.binary[i] === 1) wallPixels++;
      }
      metrics.wallPixels = wallPixels;
      metrics.wallRatio = (wallPixels / result.binary.length * 100).toFixed(2) + '%';
    }
    
    if (result.grayscale) {
      let sum = 0;
      for (let i = 0; i < result.grayscale.length; i++) {
        sum += result.grayscale[i];
      }
      const avgBrightness = sum / result.grayscale.length;
      metrics.avgBrightness = avgBrightness.toFixed(2);
    }
    
    return metrics;
  },

  /**
   * Calculate segmentation metrics
   */
  segmentationMetrics(likelihood) {
    const metrics = {};
    
    // Calculate min/max/avg without spread operator (avoid stack overflow on large arrays)
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let highLikelihood = 0;
    
    for (let i = 0; i < likelihood.length; i++) {
      const value = likelihood[i];
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      if (value > 0.5) highLikelihood++;
    }
    
    metrics.minLikelihood = min.toFixed(3);
    metrics.maxLikelihood = max.toFixed(3);
    metrics.avgLikelihood = (sum / likelihood.length).toFixed(3);
    metrics.highLikelihoodPixels = highLikelihood;
    metrics.highLikelihoodRatio = (highLikelihood / likelihood.length * 100).toFixed(2) + '%';
    
    return metrics;
  },

  /**
   * Calculate line detection metrics
   */
  lineDetectionMetrics(segments) {
    const metrics = {};
    
    metrics.totalSegments = segments.length;
    
    if (segments.length > 0) {
      let minLength = Infinity;
      let maxLength = -Infinity;
      let sumLength = 0;
      let minAngle = Infinity;
      let maxAngle = -Infinity;
      
      for (let i = 0; i < segments.length; i++) {
        const length = segments[i].length;
        const angle = segments[i].angle * 180 / Math.PI;
        
        if (length < minLength) minLength = length;
        if (length > maxLength) maxLength = length;
        sumLength += length;
        
        if (angle < minAngle) minAngle = angle;
        if (angle > maxAngle) maxAngle = angle;
      }
      
      metrics.avgLength = (sumLength / segments.length).toFixed(2) + 'px';
      metrics.minLength = minLength.toFixed(2) + 'px';
      metrics.maxLength = maxLength.toFixed(2) + 'px';
      metrics.angleRange = `${minAngle.toFixed(1)}° to ${maxAngle.toFixed(1)}°`;
    }
    
    return metrics;
  },

  /**
   * Calculate post-processing metrics
   */
  postProcessingMetrics(processed) {
    const metrics = {};
    
    metrics.totalWalls = processed.all?.length || 0;
    metrics.horizontal = processed.horizontal?.length || 0;
    metrics.vertical = processed.vertical?.length || 0;
    metrics.exterior = processed.exterior?.length || 0;
    metrics.interior = processed.interior?.length || 0;
    
    metrics.horizontalRatio = metrics.totalWalls > 0 
      ? (metrics.horizontal / metrics.totalWalls * 100).toFixed(1) + '%'
      : '0%';
    metrics.exteriorRatio = metrics.totalWalls > 0
      ? (metrics.exterior / metrics.totalWalls * 100).toFixed(1) + '%'
      : '0%';
    
    return metrics;
  },

  /**
   * Calculate perimeter metrics
   */
  perimeterMetrics(perimeter, imageWidth, imageHeight) {
    const metrics = {};
    
    if (!perimeter || !perimeter.vertices) {
      metrics.status = 'Not built';
      return metrics;
    }
    
    metrics.vertices = perimeter.vertices.length;
    
    // Calculate perimeter length
    let perimeterLength = 0;
    for (let i = 0; i < perimeter.vertices.length; i++) {
      const v1 = perimeter.vertices[i];
      const v2 = perimeter.vertices[(i + 1) % perimeter.vertices.length];
      const dist = Math.sqrt((v2.x - v1.x) ** 2 + (v2.y - v1.y) ** 2);
      perimeterLength += dist;
    }
    metrics.perimeterLength = perimeterLength.toFixed(2) + 'px';
    
    // Calculate area
    let area = 0;
    for (let i = 0; i < perimeter.vertices.length; i++) {
      const v1 = perimeter.vertices[i];
      const v2 = perimeter.vertices[(i + 1) % perimeter.vertices.length];
      area += v1.x * v2.y - v2.x * v1.y;
    }
    area = Math.abs(area) / 2;
    metrics.area = area.toFixed(2) + 'px²';
    metrics.imageArea = (imageWidth * imageHeight) + 'px²';
    metrics.coverage = (area / (imageWidth * imageHeight) * 100).toFixed(1) + '%';
    
    return metrics;
  }
};

/**
 * Logger for detailed test output
 */
export class TestLogger {
  constructor() {
    this.logs = [];
  }

  log(level, stepName, message, data = null) {
    const entry = {
      timestamp: performance.now(),
      level,
      stepName,
      message,
      data
    };
    this.logs.push(entry);
    
    // Also output to console with color coding
    const prefix = `[${stepName}]`;
    if (level === 'error') {
      console.error(prefix, message, data || '');
    } else if (level === 'warning') {
      console.warn(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }

  info(stepName, message, data) {
    this.log('info', stepName, message, data);
  }

  warning(stepName, message, data) {
    this.log('warning', stepName, message, data);
  }

  error(stepName, message, data) {
    this.log('error', stepName, message, data);
  }

  getLogs() {
    return this.logs;
  }

  getLogsByStep(stepName) {
    return this.logs.filter(log => log.stepName === stepName);
  }
}
