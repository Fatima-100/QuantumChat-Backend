// Server-side source of truth for chat-theme options. Kept here (not just
// hard-coded in the frontend) so the API can validate incoming theme
// selections instead of trusting arbitrary strings/colors from the client,
// and so the frontend can fetch this catalog instead of duplicating it.
//
// Each BUBBLE_COLOR/WALLPAPER has a stable `id` — that id (not a raw hex
// value or file) is what gets stored on a ChatTheme document for presets.
// 'custom' is a reserved wallpaperId meaning "the owner uploaded their own
// image" (see ChatTheme.wallpaperPath) — it is never a member of WALLPAPERS
// itself and can only be set by the upload endpoint, never by PUT directly.

export const BUBBLE_COLORS = [
  { id: 'default', name: 'Default', mine: '#6366f1', theirs: '#ffffff', fg: '#ffffff' },
  { id: 'iris', name: 'Iris', mine: '#7c5cff', theirs: '#ffffff', fg: '#ffffff' },
  { id: 'forest', name: 'Forest', mine: '#1f9e6b', theirs: '#ffffff', fg: '#ffffff' },
  { id: 'sunset', name: 'Sunset', mine: '#e07a3f', theirs: '#ffffff', fg: '#ffffff' },
  { id: 'rose', name: 'Rose', mine: '#d0538b', theirs: '#ffffff', fg: '#ffffff' },
  { id: 'slate', name: 'Slate', mine: '#5b6b7c', theirs: '#ffffff', fg: '#ffffff' },
];

// Named preset wallpapers (rendered client-side as CSS patterns). 'custom'
// is handled entirely separately — see CUSTOM_WALLPAPER_ID below.
export const WALLPAPERS = [
  { id: 'none', name: 'None' },
  { id: 'quantum-dots', name: 'Quantum Dots' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'circuit', name: 'Circuit' },
  { id: 'floral', name: 'Floral' },
  { id: 'geometric', name: 'Geometric' },
  { id: 'stardust', name: 'Stardust' },
  { id: 'nebula', name: 'Nebula Glow' },
  { id: 'prism', name: 'Prism' },
];

export const CUSTOM_WALLPAPER_ID = 'custom';

// The top "Themes" grid is a named shortcut that sets both bubbleColorId
// and wallpaperId at once. "Create with AI" is intentionally not modeled
// server-side for this pass, and no preset points at a custom wallpaper —
// presets are always one of the named WALLPAPERS above.
export const THEME_PRESETS = [
  { id: 'default', name: 'Default', bubbleColorId: 'default', wallpaperId: 'none' },
  { id: 'iris-aurora', name: 'Iris', bubbleColorId: 'iris', wallpaperId: 'aurora' },
  { id: 'forest-floral', name: 'Forest', bubbleColorId: 'forest', wallpaperId: 'floral' },
  { id: 'sunset-geometric', name: 'Sunset', bubbleColorId: 'sunset', wallpaperId: 'geometric' },
  { id: 'rose-circuit', name: 'Rose', bubbleColorId: 'rose', wallpaperId: 'circuit' },
  { id: 'slate-quantum-dots', name: 'Slate', bubbleColorId: 'slate', wallpaperId: 'quantum-dots' },
];

const bubbleColorIds = new Set(BUBBLE_COLORS.map((b) => b.id));
const wallpaperIds = new Set(WALLPAPERS.map((w) => w.id));
const presetIds = new Set(THEME_PRESETS.map((p) => p.id));

export function isValidBubbleColorId(id) {
  return typeof id === 'string' && bubbleColorIds.has(id);
}

// Deliberately excludes CUSTOM_WALLPAPER_ID — callers that need to accept
// "custom" as well (e.g. read paths) should check that separately, so it's
// never possible to set wallpaperId: 'custom' through the generic
// bubble/wallpaper customize endpoint without an actual uploaded file.
export function isValidWallpaperId(id) {
  return typeof id === 'string' && wallpaperIds.has(id);
}

export function isValidPresetId(id) {
  return typeof id === 'string' && presetIds.has(id);
}

export function getPresetById(id) {
  return THEME_PRESETS.find((p) => p.id === id) || null;
}

export function getCatalog() {
  return { presets: THEME_PRESETS, bubbleColors: BUBBLE_COLORS, wallpapers: WALLPAPERS };
}
