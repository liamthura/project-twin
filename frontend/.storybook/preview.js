// The app's Tailwind layer and CSS custom properties. Without this, every
// story renders unstyled and visual review is worthless.
import "../src/globals.css";

/** @type {import('@storybook/react-vite').Preview} */
export default {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },
  },
};
