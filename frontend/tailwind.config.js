/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // Interactive text. Separate from primary because a colour used as a
        // fill wants to be darker (so its label passes) while the same colour
        // used as text wants to be lighter (so it passes on the page).
        link: "hsl(var(--link))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        // Brand layer, marketing page only. See globals.css: ground-inverse
        // and on-inverse deliberately do not invert between modes.
        "ground-inverse": "hsl(var(--ground-inverse))",
        "on-inverse": "hsl(var(--on-inverse))",
        clay: {
          DEFAULT: "hsl(var(--clay))",
          tint: "hsl(var(--tint-clay))",
        },
        verdigris: {
          DEFAULT: "hsl(var(--verdigris))",
          tint: "hsl(var(--tint-verdigris))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
        // Display face, marketing page only, and only at 40px and above --
        // below that the notches stop being a signal and it just reads as a
        // slightly-off Geist. NO WEBFONT IS LOADED YET: the design was set in
        // Stack Sans Notch inside Figma and the licensed file is not in the
        // repo, so this currently falls through to Geist everywhere. See
        // docs/superpowers/specs/2026-08-04-mygist-landing-design.md.
        display: ["Stack Sans Notch", "Geist", "system-ui", "sans-serif"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // The caret in the invite-code slots. input-otp hides the real one and
        // asks us to draw it, since the input itself spans all eight boxes.
        // shadcn's config ships this; MyGist's is hand-written, so it is added
        // here rather than by adopting theirs wholesale.
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
