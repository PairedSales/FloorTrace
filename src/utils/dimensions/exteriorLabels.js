// Non-GLA feature labels (garage, porch, patio, deck, balcony…) mark regions
// that belong to the drawing but not to the living area: the boundary tracer
// carves them out of the footprint so area/perimeter cover the GLA only.

const EXTERIOR_FEATURE_RE =
  /\b(garages?|porch(?:es)?|patios?|decks?|sun\s?decks?|balcon(?:y|ies)|terraces?|veranda[hs]?|lanais?|stoops?|breezeways?|carports?|pergolas?|gazebos?|porticos?|courtyards?|swimming\s*pools?|planters?)\b/i;

export const matchExteriorFeature = (text) => {
  const match = typeof text === 'string' ? text.match(EXTERIOR_FEATURE_RE) : null;
  return match ? match[1].toLowerCase().replace(/\s+/g, '') : null;
};

// room.rect is {left,right,top,bottom}; a label bbox is {x,y,width,height}.
const overlapsRect = (bbox, rect) => (
  bbox && rect
  && rect.left < bbox.x + bbox.width && bbox.x < rect.right
  && rect.top < bbox.y + bbox.height && bbox.y < rect.bottom
);

// One definition of "this room is not living area", shared by the scale vote
// and by the tracer's known-inside constraints, which each used to decide it
// differently. Two independent tests because either alone misses: a label read
// as one line (GARAGE 20'-7" x 9'-6") carries the keyword in the room's own
// text, while a standalone name label only ever sits inside the room it names,
// so any overlap is the signal. Testing the *centroid* against the label box
// instead — what both callers used to do — asked whether a 320x150px garage's
// middle landed inside an 18px-tall strip of text, which turns on where the
// name was printed rather than on what it says.
export const roomIsNonGla = (room, labels = []) => {
  if (!room) return false;
  if (matchExteriorFeature(room.labelId ?? room.name ?? '')) return true;
  if (!room.rect) return false;
  // Callers pass either the labels or their bare bboxes.
  return labels.some((l) => overlapsRect(l?.bbox ?? l, room.rect));
};
