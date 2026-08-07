// Layout metrics for the app shell.
//
// The top ad banner has been removed entirely — the app now expands to the very
// top edge of the screen. BANNER_HEIGHT is kept at 0 so any legacy consumer that
// still adds the offset contributes no empty space.
export const BANNER_HEIGHT = 0;

export const AD_CONFIG = {
  BANNER_HEIGHT,
  Z_INDEX: 10,
  TOP_OFFSET: 0,
  BOTTOM_NAV_HEIGHT: 54,
} as const;

export const getBottomNavOffset = () => `${AD_CONFIG.BOTTOM_NAV_HEIGHT}px`;

/** Top offset for absolutely positioned chrome: safe-area inset only. */
export const getAppTopOffset = () => "env(safe-area-inset-top, 0px)";
