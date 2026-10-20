const { dark } = require('./theme/palette');

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');

// Classes use role names (bg-surface, text-ink-muted, border-violet/40), never raw palette steps.
// Each resolves to a CSS variable, so a theme only has to swap the variables.
const colors = Object.fromEntries(
  Object.keys(dark).map((key) => [kebab(key), `rgb(var(--color-${kebab(key)}) / <alpha-value>)`]),
);
const variables = Object.fromEntries(Object.entries(dark).map(([key, hex]) => [`--color-${kebab(key)}`, channels(hex)]));

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    // Replaces Tailwind's palette entirely: an unmapped class like bg-slate-900 has no effect.
    colors: { transparent: 'transparent', current: 'currentColor', ...colors },
  },
  plugins: [({ addBase }) => addBase({ ':root': variables })],
};
