// Non-GLA region arbitration. Four independent detectors (OCR label votes,
// label floods, geometric garage evidence, shaded pockets) each catch real
// cases no other one does, so none can be dropped — but applied blindly one
// after another they carved a shrinking footprint with no cumulative bound and
// an order-dependent result.
//
// Here every detector emits *candidate regions* with a source and a
// confidence, overlapping candidates are merged into one region carrying both
// sources, and a single arbitration step decides what is removed under one
// cumulative bound. Regions are first-class objects so the result can say what
// was excluded and why.

import { bridgeRuns, dilateRect, labelComponents, openRect } from './raster.js';
import { findGarageCavities } from './garage.js';

const bboxAreaOf = (bbox) => (bbox.maxX - bbox.minX + 1) * (bbox.maxY - bbox.minY + 1);

const largestComponent = (mask, width, height) => {
  const { labels, components } = labelComponents(mask, width, height);
  if (!components.length) return null;
  let best = components[0];
  for (const comp of components) {
    if (comp.size > best.size) best = comp;
  }
  return { labels, component: best };
};

export const componentMask = (labels, component, width) => {
  const mask = new Uint8Array(labels.length);
  const { minX, minY, maxX, maxY } = component.bbox;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (labels[row + x] === component.id) mask[row + x] = 1;
    }
  }
  return mask;
};

// Enclosed open cavities of the footprint: footprint minus a door-bridged wall
// barrier, so a garage, a porch or a terrace is its own region. The barrier is
// derived from the wall mask rather than from the seal's closing — tying it to
// the picked seal radius made the whole non-GLA stage depend on a variable it
// does not own, and at a small radius every room merged into one cavity so
// large that every label vote was thrown away as "too big to be non-GLA".
const openCavities = (footprint, barrier, width, height) => {
  const open = new Uint8Array(footprint.mask.length);
  for (let i = 0; i < open.length; i += 1) {
    open[i] = footprint.mask[i] && !barrier[i] ? 1 : 0;
  }
  return labelComponents(open, width, height);
};

const cavityVote = (region, labels, width, height) => {
  const votes = new Map();
  for (let sy = 0; sy <= 4; sy += 1) {
    for (let sx = 0; sx <= 4; sx += 1) {
      const x = Math.round(region.x + (region.width * sx) / 4);
      const y = Math.round(region.y + (region.height * sy) / 4);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const id = labels[y * width + x];
      if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestVotes = 0;
  for (const [id, count] of votes) {
    if (count > bestVotes) {
      best = id;
      bestVotes = count;
    }
  }
  return best;
};

// Fallback for labels whose cavity vote failed: screened pool cages and
// similar enclosures are so dense with internal linework that the seal's
// closing covers them entirely, leaving no open cavity to vote for. Flood from
// the label instead, crossing thin decoration ink freely but stopping at
// full-thickness walls (bridged across their window/door gaps).
const floodLabelledRegion = (region, footprint, barrier, width, height) => {
  const mask = new Uint8Array(footprint.mask.length);
  const queue = [];
  for (let sy = 0; sy <= 4; sy += 1) {
    for (let sx = 0; sx <= 4; sx += 1) {
      const x = Math.round(region.x + (region.width * sx) / 4);
      const y = Math.round(region.y + (region.height * sy) / 4);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      if (footprint.mask[i] && !barrier[i] && !mask[i]) {
        mask[i] = 1;
        queue.push(i);
      }
    }
  }
  let size = queue.length;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    const x = i % width;
    const y = (i / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const neighbours = [i - 1, i + 1, i - width, i + width];
    if (x === 0) neighbours[0] = -1;
    if (x === width - 1) neighbours[1] = -1;
    for (const n of neighbours) {
      if (n < 0 || n >= mask.length || mask[n]) continue;
      if (!footprint.mask[n] || barrier[n]) continue;
      mask[n] = 1;
      queue.push(n);
      size += 1;
    }
  }
  if (maxX < 0) return null;
  return { mask, size, bbox: { minX, minY, maxX, maxY } };
};

// Screened (grey-filled) pockets: condo plans shade terraces/balconies instead
// of labelling them. Works on the footprint's grayscale directly — a narrow
// terrace is swallowed whole by a large seal closing, so it never shows up as
// an open cavity.
const findShadedPockets = (gray, ink, footprint, width, height, minCavity, exteriorThickness) => {
  if (!gray || !ink) return null;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < footprint.mask.length; i += 1) {
    if (footprint.mask[i] && !ink[i]) {
      hist[gray[i]] += 1;
      count += 1;
    }
  }
  if (!count) return null;
  // Threshold below the dominant page/room tone. The median moves with
  // whatever else happens to be inside the footprint — which made the whole
  // detector depend on the seal radius — whereas the modal tone is the paper
  // or the room fill the plan is drawn on.
  let pageMode = 255;
  let bestMass = -1;
  for (let v = 1; v < 255; v += 1) {
    const mass = hist[v - 1] + hist[v] * 2 + hist[v + 1];
    if (mass > bestMass) {
      bestMass = mass;
      pageMode = v;
    }
  }

  const thr = pageMode - 12;
  const shaded = new Uint8Array(footprint.mask.length);
  for (let i = 0; i < shaded.length; i += 1) {
    shaded[i] = footprint.mask[i] && !ink[i] && gray[i] < thr ? 1 : 0;
  }
  const { labels, components } = labelComponents(shaded, width, height);
  const found = [];
  for (const comp of components) {
    if (comp.size < minCavity || comp.size > 0.45 * footprint.area) continue;
    // Uniform shading fills its bbox; halo rings around linework do not.
    if (comp.size < 0.35 * bboxAreaOf(comp.bbox)) continue;
    // A room-sized feature is wide both ways; thin dark strips are window
    // glazing bands, not terraces.
    const w = comp.bbox.maxX - comp.bbox.minX + 1;
    const h = comp.bbox.maxY - comp.bbox.minY + 1;
    if (Math.min(w, h) < 3 * exteriorThickness) continue;
    // Genuine non-GLA shading is one flat tint; colour-styled plans wash room
    // interiors with gradients whose below-threshold tail forms a pocket
    // spanning many gray levels. Carving those guts the footprint.
    const ghist = new Uint32Array(256);
    let n = 0;
    for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
      const row = y * width;
      for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
        if (labels[row + x] === comp.id) {
          ghist[gray[row + x]] += 1;
          n += 1;
        }
      }
    }
    let cum10 = 0;
    let p10 = 0;
    let p90 = 255;
    for (let v = 0; v < 256; v += 1) {
      cum10 += ghist[v];
      if (cum10 >= n * 0.1) {
        p10 = v;
        break;
      }
    }
    let cum90 = 0;
    for (let v = 0; v < 256; v += 1) {
      cum90 += ghist[v];
      if (cum90 >= n * 0.9) {
        p90 = v;
        break;
      }
    }
    if (p90 - p10 > 10) continue;
    found.push({ id: comp.id, comp, labels });
  }
  return found.length ? { labels, found } : null;
};

const overlapFrac = (a, b) => {
  let inter = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] && b[i]) inter += 1;
  return inter;
};

const SOURCE_CONFIDENCE = {
  label: 0.9,
  'label-flood': 0.7,
  garage: 0.65,
  shaded: 0.5,
};

/**
 * Candidate non-GLA regions for one footprint, from every evidence source.
 * Returns first-class region objects; nothing is removed here.
 */
export const collectNonGlaRegions = (footprint, analysis, options) => {
  const { width, height, wallThickness } = analysis;
  const wallMask = options.wallMask ?? analysis.wallMask;
  const exteriorThickness = options.exteriorThickness;
  const minCavity = Math.max(16, exteriorThickness * exteriorThickness * 4);
  const regions = [];

  const fpW = footprint.bbox.maxX - footprint.bbox.minX + 1;
  const fpH = footprint.bbox.maxY - footprint.bbox.minY + 1;

  // `barrier` and `cavities` are page-sized — a door-bridged wall barrier plus
  // a full-page component labelling — and everything that reads them is gated:
  // the label-vote loop needs `excludeRegions`, `findGarageCavities` needs
  // `autoGarage`, and the flood block below needs the label loop to have
  // resolved something. `findShadedPockets` reads neither.
  //
  // The room-clamp trace passes `autoGarage: false` and no excludeRegions, so
  // on the automatic path this was computed in full and thrown away on every
  // clamped floor — profiled at ~15% of step 4, of which bridgeRuns is ~64%.
  const wantsCavities = (options.excludeRegions?.length ?? 0) > 0
    || options.autoGarage !== false;
  const barrier = wantsCavities
    ? bridgeRuns(
      analysis.thickMask, width, height,
      Math.max(24, wallThickness * 12, Math.round(Math.max(fpW, fpH) * 0.3)),
      Math.max(8, wallThickness * 2),
    )
    : null;
  const cavities = wantsCavities
    ? openCavities(footprint, barrier, width, height)
    : { labels: null, components: [] };
  const resolved = [];
  const unresolved = [];
  const garageCavityIds = new Set();

  if (cavities.components.length) {
    for (const region of options.excludeRegions ?? []) {
      const id = cavityVote(region, cavities.labels, width, height);
      if (id < 0) {
        unresolved.push(region);
        continue;
      }
      const comp = cavities.components[id];
      if (comp.size < minCavity || comp.size > 0.45 * footprint.area) continue;
      resolved.push({ region, id });
      regions.push({
        source: 'label',
        keyword: region.keyword ?? null,
        mask: componentMask(cavities.labels, comp, width),
        size: comp.size,
        bbox: comp.bbox,
        confidence: SOURCE_CONFIDENCE.label,
      });
      if (region.keyword && /garage/i.test(region.keyword)) garageCavityIds.add(id);
    }

    if (options.autoGarage !== false) {
      const garages = findGarageCavities({
        labels: cavities.labels,
        components: cavities.components,
        footprint,
        wallMask,
        ink: analysis.ink,
        width,
        height,
        exteriorThickness,
        minCavity,
      });
      for (const id of garages) {
        const comp = cavities.components[id];
        regions.push({
          source: 'garage',
          keyword: 'garage',
          mask: componentMask(cavities.labels, comp, width),
          size: comp.size,
          bbox: comp.bbox,
          confidence: SOURCE_CONFIDENCE.garage,
        });
      }
    }
  }

  if (resolved.length || unresolved.length) {
    // A door-swing arc drawn across a patio splits its slab into several open
    // cavities and the label votes only one in; flood the label across thin
    // ink too and offer whatever it covers.
    for (const { region, id } of resolved) {
      const flooded = floodLabelledRegion(region, footprint, barrier, width, height);
      if (!flooded || flooded.size > 0.45 * footprint.area) continue;
      let extra = 0;
      for (let i = 0; i < flooded.mask.length; i += 1) {
        if (flooded.mask[i] && cavities.labels[i] !== id) extra += 1;
      }
      if (extra < Math.max(minCavity / 2, 0.05 * flooded.size)) continue;
      regions.push({
        source: 'label-flood',
        keyword: region.keyword ?? null,
        mask: flooded.mask,
        size: flooded.size,
        bbox: flooded.bbox,
        confidence: SOURCE_CONFIDENCE['label-flood'],
        mergesWith: 'label',
      });
    }
    for (const region of unresolved) {
      const flooded = floodLabelledRegion(region, footprint, barrier, width, height);
      if (!flooded || flooded.size < minCavity || flooded.size > 0.45 * footprint.area) continue;
      regions.push({
        source: 'label-flood',
        keyword: region.keyword ?? null,
        mask: flooded.mask,
        size: flooded.size,
        bbox: flooded.bbox,
        confidence: SOURCE_CONFIDENCE['label-flood'],
      });
    }
  }

  if (options.autoShaded !== false) {
    const pockets = findShadedPockets(
      analysis.gray, analysis.ink, footprint, width, height, minCavity, exteriorThickness,
    );
    for (const pocket of pockets?.found ?? []) {
      regions.push({
        source: 'shaded',
        keyword: null,
        mask: componentMask(pockets.labels, pocket.comp, width),
        size: pocket.comp.size,
        bbox: pocket.comp.bbox,
        confidence: SOURCE_CONFIDENCE.shaded,
      });
    }
  }

  return regions;
};

// Merge candidates covering the same physical area: two sources agreeing is
// one region with higher confidence, not two carves.
export const arbitrateRegions = (regions) => {
  const merged = [];
  for (const region of regions) {
    const host = merged.find((m) => {
      const inter = overlapFrac(m.mask, region.mask);
      return inter >= 0.5 * Math.min(m.size, region.size);
    });
    if (!host) {
      merged.push({ ...region, sources: [region.source], mask: region.mask.slice() });
      continue;
    }
    for (let i = 0; i < host.mask.length; i += 1) if (region.mask[i]) host.mask[i] = 1;
    host.size = 0;
    for (let i = 0; i < host.mask.length; i += 1) host.size += host.mask[i];
    host.bbox = {
      minX: Math.min(host.bbox.minX, region.bbox.minX),
      minY: Math.min(host.bbox.minY, region.bbox.minY),
      maxX: Math.max(host.bbox.maxX, region.bbox.maxX),
      maxY: Math.max(host.bbox.maxY, region.bbox.maxY),
    };
    if (!host.sources.includes(region.source)) host.sources.push(region.source);
    host.keyword = host.keyword ?? region.keyword;
    host.confidence = Math.min(0.98, 1 - (1 - host.confidence) * (1 - region.confidence * 0.5));
  }
  return merged.sort((a, b) => b.confidence - a.confidence || b.size - a.size);
};

/**
 * Remove accepted regions from the footprint in ONE pass, so the result cannot
 * depend on detector order, and stop at a cumulative bound so three
 * individually-safe carves cannot between them remove most of the building.
 */
export const applyRegions = (footprint, regions, analysis, options) => {
  const { width, height } = analysis;
  const exteriorThickness = options.exteriorThickness;
  const maxCumulative = options.maxCumulativeRemoval ?? 0.5;
  const originalArea = footprint.area;

  const accepted = [];
  const rejected = [];
  const remove = new Uint8Array(footprint.mask.length);
  let removedArea = 0;
  for (const region of regions) {
    if (removedArea + region.size > maxCumulative * originalArea) {
      rejected.push({ ...region, reason: 'cumulative-bound' });
      continue;
    }
    for (let i = 0; i < remove.length; i += 1) if (region.mask[i]) remove[i] = 1;
    removedArea += region.size;
    accepted.push(region);
  }
  if (!accepted.length) return { footprint, accepted: [], rejected, holes: [] };

  const mask = footprint.mask.slice();
  for (let i = 0; i < mask.length; i += 1) if (remove[i]) mask[i] = 0;

  // Clip an opening back to the carved mask so its dilation cannot refill what
  // was removed, and apply it only near the carved regions — a global opening
  // would also shave every narrow footprint protrusion (bay windows) far away.
  const openR = Math.max(2, exteriorThickness + 2);
  const opened = openRect(mask, width, height, openR);
  const zone = dilateRect(remove, width, height, openR * 2 + 2);
  for (let i = 0; i < opened.length; i += 1) {
    if (!mask[i]) opened[i] = 0;
    else if (!zone[i]) opened[i] = mask[i];
  }

  const labeled = largestComponent(opened, width, height);
  if (!labeled || labeled.component.size < 0.35 * originalArea) {
    return { footprint, accepted: [], rejected: regions.map((r) => ({ ...r, reason: 'guard' })), holes: [] };
  }

  const { component, labels: newLabels } = labeled;
  const newMask = componentMask(newLabels, component, width);

  // A carve that removed an entirely interior region (a courtyard, a light
  // well) leaves a void the outer contour cannot express. Those become holes
  // instead of being silently dropped with the rest of the non-largest
  // components.
  const holes = [];
  // Plain loop, not `Uint8Array.from(mask, fn)`: the mapper form walks the
  // iterator protocol and dispatches per element, ~92 ns/px against ~4 ns/px.
  const voids = new Uint8Array(newMask.length);
  for (let i = 0; i < voids.length; i += 1) voids[i] = newMask[i] ? 0 : 1;
  const { labels: voidLabels, components: voidComps } = labelComponents(voids, width, height);
  for (const comp of voidComps) {
    if (comp.bbox.minX === 0 || comp.bbox.minY === 0
      || comp.bbox.maxX === width - 1 || comp.bbox.maxY === height - 1) continue;
    if (comp.size < 0.004 * originalArea) continue;
    holes.push({ labels: voidLabels, componentId: comp.id, size: comp.size, bbox: comp.bbox });
  }

  return {
    footprint: {
      ...footprint,
      mask: newMask,
      labels: newLabels,
      // Page-sized labels from `largestComponent`, so no crop frame.
      frame: null,
      componentId: component.id,
      area: component.size,
      bbox: component.bbox,
      bboxArea: bboxAreaOf(component.bbox),
    },
    accepted,
    rejected,
    holes,
  };
};
