import { useSyncExternalStore } from 'react';

/**
 * Which shell the app is wearing.
 *
 * Two independent questions, deliberately not collapsed into one:
 *
 *  - `isMobile` is about **room**. Below this width the desktop shell cannot
 *    exist: its two docks alone are 476 px, which is wider than the phone.
 *  - `isTouch` is about **reach**. A 44 px target and a pinch gesture are right
 *    on a touchscreen laptop too, and wrong on a narrow mouse-driven window.
 *
 * The breakpoint is 820 px rather than Tailwind's 768: at 768 the desktop shell
 * is technically laid out but the canvas is 300 px wide with a 320 px panel
 * beside it, which is not a usable plan view. Tablets in landscape (1024) keep
 * the desktop shell — that is the layout they have the room for — but still get
 * touch targets and gestures, because `isTouch` is a separate query.
 */

const MOBILE_QUERY = '(max-width: 819.98px)';
const TOUCH_QUERY = '(pointer: coarse)';
const SHORT_QUERY = '(max-height: 460px)';

// One MediaQueryList per query, shared by every caller: a fresh `subscribe`
// identity per render makes useSyncExternalStore tear down and re-add a
// listener on every render of every consumer.
const cache = new Map();

const entry = (query) => {
  let hit = cache.get(query);
  if (!hit) {
    const mq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query)
      : null;
    hit = {
      mq,
      subscribe: (onChange) => {
        if (!mq) return () => {};
        // `addListener` is the Safari < 14 spelling; still shipped on iOS
        // versions this app is otherwise happy to run on.
        if (mq.addEventListener) {
          mq.addEventListener('change', onChange);
          return () => mq.removeEventListener('change', onChange);
        }
        mq.addListener(onChange);
        return () => mq.removeListener(onChange);
      },
      getSnapshot: () => (mq ? mq.matches : false),
    };
    cache.set(query, hit);
  }
  return hit;
};

const useMedia = (query) => {
  const { subscribe, getSnapshot } = entry(query);
  // Server snapshot is `false` for both: the desktop shell is the one that
  // renders without JS deciding anything, so a mismatch corrects toward mobile
  // rather than flashing a 476 px dock onto a phone.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};

/** True when the viewport is too narrow for the docked desktop shell. */
export const useIsMobile = () => useMedia(MOBILE_QUERY);

/** True when the primary pointer is a finger — targets, gestures, no hover. */
export const useIsTouch = () => useMedia(TOUCH_QUERY);

/** True for a phone held in landscape: wide enough, but almost no height. */
export const useIsShort = () => useMedia(SHORT_QUERY);

/**
 * Non-reactive read for code outside React (event handlers, imperative canvas
 * setup). Prefer the hooks in components — this exists because the Konva hit
 * geometry is computed inside handlers that never re-render.
 */
export const isTouchDevice = () => entry(TOUCH_QUERY).getSnapshot()
  || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
