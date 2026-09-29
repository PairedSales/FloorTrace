// A saved plan built in code, for tests that run `bench:real` without the set:
// a black wall rectangle on white with its key drawn on the outer face, so the
// tracer scores it in about half a second. Not a test file: the suites import it.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { createImage, wallRect } from '../../../src/utils/detection/__tests__/synthetic.js';
import { keyOf } from '../realKeys.mjs';

// `shift` moves the key's right edge, which is another key.
export const syntheticProject = ({ width = 480, height = 360, shift = 0 } = {}) => {
  const img = createImage(width, height);
  wallRect(img, 60, 60, width - 60, height - 60, 8);
  const png = new PNG({ width, height });
  png.data = Buffer.from(img.data);
  const right = width - 57 + shift;
  const bottom = height - 57;
  return {
    images: { img: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}` },
    floors: [{
      state: {
        imageRef: 'img',
        perimeterTraces: [{
          id: 'trace-1',
          type: 'gla',
          closed: true,
          vertices: [{ x: 56, y: 56 }, { x: right, y: 56 }, { x: right, y: bottom }, { x: 56, y: bottom }],
          typeSource: 'user',
          nameSource: 'auto',
          quality: { source: 'manual', edited: true },
        }],
        detectedDimensions: [],
        exteriorLabels: [],
      },
    }],
  };
};

export const keyOfProject = (project) => keyOf(project.floors[0].state);

export const writePlan = (dir, name, options) => {
  const project = syntheticProject(options);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.floorplan`);
  fs.writeFileSync(file, JSON.stringify(project));
  return { file, project, key: keyOfProject(project) };
};
