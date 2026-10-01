// The walkthrough of the exterior tracer, generated from the real pipeline by
// `npm run tutorial` into public/tracing-tutorial.html.
//
// Help on the desktop and the phone's menu both open it, so the URL lives
// here rather than in two copies — a page that moved would otherwise 404 from
// whichever one was forgotten. `BASE_URL` is `/FloorTrace/` in the deployed build and `/` in dev.
export const TRACING_TUTORIAL_URL =
  `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}tracing-tutorial.html`;

// A new tab rather than a navigation: the plan in front of the user is
// unsaved work, and the page is something to read *beside* it.
export const openTracingTutorial = () => {
  window.open(TRACING_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
};
