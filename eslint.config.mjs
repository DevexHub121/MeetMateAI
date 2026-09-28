import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Minified ONNX Runtime, copied out of node_modules by
    // scripts/prepare-voice-assets.mjs. Vendor code we don't author or ship
    // through the bundler — linting it produced ~345 warnings about generated
    // output and drowned the real ones.
    "public/ort/**",
  ]),
]);

export default eslintConfig;
