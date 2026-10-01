// Two versions of FloorTrace are published side by side while the simplified
// one is being worked on (`.github/workflows/deploy.yml`): this one at the
// site's root, and the simplified one under `next/`.
//
// Each keeps its own plans and settings, so a plan is carried across with a
// project file rather than by following this link.
export const SIMPLIFIED_VERSION_URL =
  `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}next/`;

// A new tab rather than a navigation: the plan in front of the user stays
// where it is, and the two versions are meant to be used beside each other.
export const openSimplifiedVersion = () => {
  window.open(SIMPLIFIED_VERSION_URL, '_blank', 'noopener');
};
