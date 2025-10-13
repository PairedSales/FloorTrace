/**
 * testSetup.js
 * Setup file for Vitest tests
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Mock OpenCV.js for testing
beforeAll(() => {
  // Mock cv object
  globalThis.cv = {
    Mat: class Mat {
      constructor() {
        this.rows = 0;
        this.cols = 0;
        this.data32S = new Int32Array(0);
      }
      delete() {}
      copyTo() {}
      channels() { return 3; }
    },
    
    imread: vi.fn(() => {
      return new globalThis.cv.Mat();
    }),
    
    imshow: vi.fn(),
    
    cvtColor: vi.fn(),
    GaussianBlur: vi.fn(),
    Canny: vi.fn(),
    HoughLinesP: vi.fn((src, dst) => {
      // Mock some line detection results
      dst.rows = 4;
      dst.data32S = new Int32Array([
        0, 0, 100, 0,     // Line 1
        100, 0, 100, 100, // Line 2
        100, 100, 0, 100, // Line 3
        0, 100, 0, 0      // Line 4
      ]);
    }),
    
    COLOR_RGBA2GRAY: 6,
    COLOR_RGB2GRAY: 7,
    BORDER_DEFAULT: 4,
    
    Size: class Size {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
    }
  };
  
  // Mock Image constructor
  if (typeof window !== 'undefined') {
    window.Image = class MockImage {
      constructor() {
        this.width = 1024;
        this.height = 768;
        this.naturalWidth = 1024;
        this.naturalHeight = 768;
        this.complete = false;
        this.src = '';
      }
      
      set src(value) {
        this._src = value;
        setTimeout(() => {
          this.complete = true;
          if (this.onload) this.onload();
        }, 0);
      }
      
      get src() {
        return this._src;
      }
    };
  }
  
  console.log('Test setup complete: OpenCV and Image mocks installed');
});

afterAll(() => {
  console.log('Test cleanup complete');
});
