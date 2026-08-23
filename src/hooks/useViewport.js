import { useSyncExternalStore } from 'react';

/**
 * Which shell the app is wearing.
 *
 * Two independent questions, deliberately not collapsed into one:
 *
 *  - `isMobile` is about **room**. Below this width the desktop shell cannot
 *    exist: the measurement dock and the tool rail are 368 px between them
 *    before the plan gets a pixel, and the tab strip and status bar inset
 *    between them need a strip worth reading.
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

