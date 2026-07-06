// Exterior-feature labels (porch, patio, deck, balcony…) mark regions that
// belong to the drawing but not to the main structure: the boundary tracer
// carves them out of the footprint so area/perimeter cover the house only.

const EXTERIOR_FEATURE_RE =
  /\b(porch(?:es)?|patios?|decks?|sun\s?decks?|balcon(?:y|ies)|terraces?|veranda[hs]?|lanais?|stoops?|breezeways?|carports?|pergolas?|gazebos?|porticos?|courtyards?)\b/i;

export const matchExteriorFeature = (text) => {
  const match = typeof text === 'string' ? text.match(EXTERIOR_FEATURE_RE) : null;
  return match ? match[1].toLowerCase().replace(/\s+/g, '') : null;
};
