// Non-GLA feature labels (garage, porch, patio, deck, balcony…) mark regions
// that belong to the drawing but not to the living area: the boundary tracer
// carves them out of the footprint so area/perimeter cover the GLA only.

const EXTERIOR_FEATURE_RE =
  /\b(garages?|porch(?:es)?|patios?|decks?|sun\s?decks?|balcon(?:y|ies)|terraces?|veranda[hs]?|lanais?|stoops?|breezeways?|carports?|pergolas?|gazebos?|porticos?|courtyards?|swimming\s*pools?|planters?)\b/i;

export const matchExteriorFeature = (text) => {
  const match = typeof text === 'string' ? text.match(EXTERIOR_FEATURE_RE) : null;
  return match ? match[1].toLowerCase().replace(/\s+/g, '') : null;
};
