import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { execFileSync } from 'node:child_process';

let buildRevision = 'unavailable';
try { buildRevision = execFileSync('git', ['describe', '--always', '--dirty', '--abbrev=12'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { /* Exported source archives may not contain Git metadata. */ }

export default defineConfig(({ mode }) => ({
	define: { 'import.meta.env.MOM_BUILD_REVISION': JSON.stringify(buildRevision) },
	plugins: mode === "test" || mode === "development" ? [react()] : [react(), cloudflare()],
	build: { sourcemap: false, outDir: "dist/client" },
	test: {
		environment: "node",
		include: ["tests/**/*.spec.{ts,tsx}"],
		exclude: ["tests/e2e/**"],
	},
}));
