import palette from './palette';

export type ColorName = keyof typeof palette.dark;

/**
 * The active theme's colors for props that take a color value (icons, charts, navigation).
 * Read it during render, never copy values into module-level constants, so a theme switch
 * only has to replace this object and re-render. Launch ships dark only.
 */
export const colors: Record<ColorName, string> = palette.dark;
