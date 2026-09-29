// The blind packet (scripts/lib/keyPacket.mjs): an annotator gets the image and
// what the scan read, and nothing that would show how the tracer did.
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { buildPacket, labelDrift, labelKind, labelsOf } from '../keyPacket.mjs';

const png = (w, h) => {
  const p = new PNG({ width: w, height: h });
  p.data.fill(255);
  return PNG.sync.write(p);
};
const dataUrl = (bytes, mime = 'image/png') => `data:${mime};base64,${bytes.toString('base64')}`;

describe('labelKind', () => {
  it('is nonGla for the words of space that is not living area', () => {
    for (const text of [
      'GARAGE', 'Two-car garage', 'CARPORT', 'PORCH', 'Screened Porch', 'SCREENED', 'covered patio', 'PATIO', 'DECK', 'Sun Deck',
      'TERRACE AREA', 'STOOP', 'BREEZEWAY', 'BALCONY', 'PORTICO', 'porte cochere', 'LOGGIA', 'LANAI', 'VERANDA',
      "GARAGE 20' x 9'", 'Entry Porch',
    ]) expect(labelKind(text), text).toBe('nonGla');
  });

  it('is room for everything else', () => {
    for (const text of [
      "13' 6\" x 23' 10\"", 'KITCHEN', 'LIVING ROOM', 'MASTER BEDROOM', 'CLOSET', 'SUNROOM', 'DECKED OUT', "12'x14'", '', 'BATH', 'GARDEN',
    ]) expect(labelKind(text), text).toBe('room');
    expect(labelKind(undefined)).toBe('room');
    expect(labelKind(null)).toBe('room');
  });
});

describe('the labels a scan read', () => {
  const state = {
    detectedDimensions: [
      { width: 13.5, height: 23.8333333, text: "13' 6\" x 23' 10\"", ocrText: '13-6 x 23-10', bbox: { x: 1058, y: 480, width: 144, height: 26 }, confidence: 91, format: 'inches' },
      // Directly under GARAGE: the garage's own size.
      { width: 24, height: 22, text: "24' 0\" x 22' 0\"", bbox: { x: 262, y: 434, width: 89, height: 19 }, confidence: 80 },
      { width: 12, height: 11, text: "GARAGE 12' x 11'", bbox: { x: 900, y: 100, width: 100, height: 20 } },
      { width: 9, height: 9, text: '9 x 9', bbox: null },
    ],
    exteriorLabels: [{ keyword: 'garage', text: 'GARAGE', bbox: { x: 240, y: 404, width: 139, height: 20 } }],
    areaLabels: [{ type: 'gla', keyword: 'first floor', text: 'FIRST FLOOR', bbox: { x: 124, y: 776, width: 236, height: 30 } }],
  };
  const labels = labelsOf(state);
  const byId = Object.fromEntries(labels.map((l) => [l.id, l]));

  it('gives each an id by its place in the plan\'s own list, a kind and a box', () => {
    expect(Object.keys(byId).sort()).toEqual(['a0', 'd0', 'd1', 'd2', 'e0']);
    expect(byId.d0).toMatchObject({ kind: 'room', source: 'dimension', text: "13' 6\" x 23' 10\"", widthFt: 13.5, heightFt: 23.833 });
    expect(byId.d0.bbox).toEqual({ x: 1058, y: 480, width: 144, height: 26 });
    expect(byId.e0).toMatchObject({ kind: 'nonGla', source: 'exterior', keyword: 'garage', text: 'GARAGE' });
    expect(byId.a0).toMatchObject({ kind: 'level', levelType: 'gla', keyword: 'first floor' });
  });

  it('takes a size printed under an exterior name for that space\'s own size', () => {
    expect(byId.d1).toMatchObject({ kind: 'nonGla', nameLabel: 'e0' });
    // And one whose own words say so needs no name above it.
    expect(byId.d2).toMatchObject({ kind: 'nonGla' });
    expect(byId.d2.nameLabel).toBeUndefined();
    // A room far from any name stays a room.
    expect(byId.d0.kind).toBe('room');
  });

  it('drops a label with no usable box, and carries no field the scan did not put in the list', () => {
    expect(byId.d3).toBeUndefined();
    for (const l of labels) {
      expect(Object.keys(l).every((k) => ['id', 'kind', 'source', 'text', 'bbox', 'widthFt', 'heightFt', 'nameLabel', 'keyword', 'levelType'].includes(k))).toBe(true);
    }
  });
});

describe('the blind packet', () => {
  // A plan holding everything the tracer and the scale know, each marked with
  // a value nothing else in the packet could contain.
  const project = () => ({
    fileType: 'floortrace',
    metadata: { projectId: 'real-x', projectName: 'x', createdAt: 'CREATED-MARK' },
    answerKey: { by: 'ANSWERKEY-MARK', notes: 'NOTES-MARK' },
    images: { 'img-1': dataUrl(png(40, 30)) },
    floors: [{
      id: 'f1',
      name: 'Floor 1',
      state: {
        imageRef: 'img-1',
        imageMimeType: 'image/png',
        perimeterTraces: [{
          id: 't1', type: 'gla', vertices: [{ x: 111.111, y: 222.222 }], holes: [{ ring: [{ x: 333.333, y: 1 }] }],
          quality: { confidence: 0.98765, warnings: [{ code: 'WARNING-MARK' }], source: 'auto' },
        }],
        rooms: [{ id: 'r1', rect: { left: 555.555, right: 1, top: 1, bottom: 2 }, name: 'ROOM-MARK' }],
        calibration: { calibrated: true, feetPerPixel: { x: 0.0707071, y: 0.0707071 }, source: 'room-calibration', quality: { level: 'ok', disagreement: 0.31337 } },
        lastTraceOutcome: { at: 1, level: 'good', reason: 'OUTCOME-MARK', floors: 1, source: 'auto' },
        detectedDimensions: [{
          width: 12, height: 10, text: "12' x 10'", bbox: { x: 5, y: 6, width: 20, height: 9 }, confidence: 77.7, format: 'inches',
          quality: { confidence: 0.4242 }, trace: { vertices: 'LABEL-TRACE-MARK' },
        }],
        exteriorLabels: [{ keyword: 'porch', text: 'PORCH', bbox: { x: 1, y: 2, width: 3, height: 4 }, confidence: 9.9 }],
        areaLabels: [{ type: 'gla', keyword: 'main floor', text: 'MAIN FLOOR', bbox: { x: 9, y: 9, width: 9, height: 9 } }],
      },
    }],
  });

  it('holds the image, the labels and the size, and nothing of the trace, the rooms, the scale or any quality', async () => {
    const packet = await buildPacket(project(), 'x');
    expect(packet.meta).toEqual({ name: 'x', width: 40, height: 30 });
    expect(packet.image.ext).toBe('png');
    expect(packet.labels.labels.map((l) => l.id)).toEqual(['d0', 'e0', 'a0']);
    const text = JSON.stringify([packet.labels, packet.meta]);
    for (const banned of [
      'perimeterTraces', 'rooms', 'calibration', 'feetPerPixel', 'lastTraceOutcome', 'quality', 'confidence', 'warnings',
      'answerKey', 'holes', 'vertices', 'disagreement', 'trace',
      '111.111', '222.222', '333.333', '555.555', '0.0707071', '0.98765', '0.31337', '0.4242', '77.7', '9.9',
      'WARNING-MARK', 'ROOM-MARK', 'OUTCOME-MARK', 'ANSWERKEY-MARK', 'NOTES-MARK', 'LABEL-TRACE-MARK', 'CREATED-MARK', 'ocrText',
    ]) expect(text, banned).not.toContain(banned);
  });

  it('carries the plan\'s exact image bytes', async () => {
    const p = project();
    const packet = await buildPacket(p, 'x');
    expect(packet.image.bytes.equals(Buffer.from(p.images['img-1'].split(',')[1], 'base64'))).toBe(true);
  });

  it('is the same however often it is built, and needs no trace to exist', async () => {
    const bare = project();
    delete bare.floors[0].state.perimeterTraces;
    delete bare.floors[0].state.rooms;
    delete bare.floors[0].state.calibration;
    const a = await buildPacket(bare, 'x');
    const b = await buildPacket(project(), 'x');
    expect(JSON.stringify(a.labels)).toBe(JSON.stringify(b.labels));
    expect(JSON.stringify(a.meta)).toBe(JSON.stringify(b.meta));
  });

  it('refuses nothing for a plan with no labels', async () => {
    const p = project();
    p.floors[0].state.detectedDimensions = [];
    delete p.floors[0].state.exteriorLabels;
    delete p.floors[0].state.areaLabels;
    const packet = await buildPacket(p, 'x');
    expect(packet.labels.labels).toEqual([]);
  });
});

describe('how the scan now differs from a packet', () => {
  const at = (x) => ({ x, y: 10, width: 40, height: 20 });
  const label = (id, text, x = 0, kind = 'room') => ({ id, kind, text, bbox: at(x) });

  it('is empty when the scan reads what the packet holds, in any order', () => {
    const packet = [label('d0', "10' x 12'"), label('e0', 'GARAGE', 90, 'nonGla')];
    expect(labelDrift(packet, [packet[1], packet[0]])).toEqual([]);
    expect(labelDrift([], [])).toEqual([]);
  });

  it('names a label the scan no longer reads, one it newly reads, and one that moved, changed text or changed kind', () => {
    const packet = [label('d0', "10' x 12'"), label('d1', "9' x 9'", 50), label('d2', "8' x 8'", 100), label('e0', 'GARAGE', 150, 'nonGla')];
    const live = [label('d0', "10' x 12'"), label('d1', "9' x 9'", 60), label('d2', "8' x 10'", 100), label('e0', 'GARAGE', 150, 'room'), label('d3', "5' x 5'", 200)];
    const drift = labelDrift(packet, live);
    expect(drift).toHaveLength(4);
    expect(drift[0]).toMatch(/^d1 is room "9' x 9'" at 50,10,40,20 in the packet, room "9' x 9'" at 60,10,40,20 in the scan now/);
    expect(drift[1]).toMatch(/^d2 is room "8' x 8'".*room "8' x 10'"/);
    expect(drift[2]).toMatch(/^e0 is nonGla "GARAGE".*room "GARAGE"/);
    expect(drift[3]).toBe('d3 "5\' x 5\'" is in the scan now, and not in the packet');
    expect(labelDrift(packet, packet.slice(1))).toEqual(['d0 "10\' x 12\'" is in the packet, and the scan no longer reads it']);
  });
});
