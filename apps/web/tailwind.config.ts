import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0f",
        bg2: "#12121a",
        bg3: "#1a1a2e",
        accent: "#6c5ce7",
        accent2: "#a29bfe",
        accent3: "#00cec9",
        text: "#e8e8f0",
        text2: "#a0a0b8",
      },
    },
  },
  plugins: [],
};
export default config;
