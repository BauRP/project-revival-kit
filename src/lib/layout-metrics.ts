// Layout metrics for the app shell.
//
// The application is fully ad-free: no banner space is reserved anywhere, so the
// shell expands to the very top edge of the screen and only honours the OS
// safe-area insets.
export const LAYOUT_CONFIG = {
  Z_INDEX: 10,
  TOP_OFFSET: 0,
  BOTTOM_NAV_HEIGHT: 54,
} as const;

export const getBottomNavOffset = () => `calc(${LAYOUT_CONFIG.BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))`;

/** Top offset for absolutely positioned chrome: safe-area inset only. */
export const getAppTopOffset = () => "env(safe-area-inset-top, 0px)";
