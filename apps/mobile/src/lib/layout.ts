import { useWindowDimensions } from 'react-native';

/** Android's window size classes, in dp: compact is under 600, medium to 840, expanded above. */
export const COMPACT_MAX = 600;
export const EXPANDED_MIN = 840;
/** Forms (sign in, register) stop growing here, so a field isn't a metre wide on a desktop window. */
export const FORM_MAX_WIDTH = 480;
/** Lists and settings stop growing here. */
export const CONTENT_MAX_WIDTH = 720;
/** The side panel beside the map in the two-pane layouts. */
export const PANEL_WIDTH = 400;

export type SizeClass = 'compact' | 'medium' | 'expanded';

export interface WindowLayout {
  width: number;
  height: number;
  sizeClass: SizeClass;
  /** The window is under 600 dp on its short side: a phone, however it is turned. */
  phone: boolean;
  /** Room for the map and the details side by side: an expanded window, or a short, wide one. */
  sideBySide: boolean;
}

export function layoutFor(width: number, height: number): WindowLayout {
  const sizeClass: SizeClass = width < COMPACT_MAX ? 'compact' : width < EXPANDED_MIN ? 'medium' : 'expanded';
  return {
    width,
    height,
    sizeClass,
    phone: Math.min(width, height) < COMPACT_MAX,
    sideBySide: width >= EXPANDED_MIN || (width > height && width >= 640 && height < 500),
  };
}

/** The window's size (which changes with rotation, folding and multi-window) and what it allows. */
export function useLayout(): WindowLayout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}

/**
 * Styles for a screen that is a map plus a panel of details: stacked on a narrow window (the map
 * takes `mapHeight` of it), side by side on a wide one (panel on the left, fixed width). The
 * same views either way, so nothing remounts when the window changes size and state is kept.
 */
export function splitStyles(sideBySide: boolean, mapHeight: `${number}%`) {
  return {
    container: { flex: 1, flexDirection: sideBySide ? ('row-reverse' as const) : ('column' as const) },
    map: sideBySide ? { flex: 1 } : { height: mapHeight },
    panel: sideBySide ? { flexGrow: 0, flexShrink: 0, width: PANEL_WIDTH } : { flex: 1 },
    /** The scrolling content of the panel, kept to a readable width on a medium window. */
    content: { width: '100%' as const, maxWidth: sideBySide ? PANEL_WIDTH : CONTENT_MAX_WIDTH, alignSelf: 'center' as const },
  };
}
