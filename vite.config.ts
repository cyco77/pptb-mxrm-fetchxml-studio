/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Bundle the tool icon at dist/icons/icon.svg, where package.json's top-level `icon` points.
 * PPTB resolves `icon` relative to the dist root (Verified requirement: an SVG bundled under
 * dist). Prerelease versions (e.g. 1.4.1-beta.7) get the gold Insider variant; releases get the
 * regular icon. https://docs.powerplatformtoolbox.com/tool-development/publishing
 */
function toolIcon(): Plugin {
	return {
		name: "fxs-tool-icon",
		apply: "build",
		generateBundle() {
			const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
			const isPrerelease = version.includes("-");
			const source = isPrerelease ? "icons/icon-insider.svg" : "icons/icon.svg";
			this.emitFile({ type: "asset", fileName: "icons/icon.svg", source: readFileSync(source, "utf8") });
		},
	};
}

/**
 * Dev harness only (`npm run dev:harness` = `vite --mode harness`): runs the real UI in a browser
 * against a live org through a stubbed PPTB host and an Azure CLI–authenticated proxy (#78).
 * Never loaded for `vite build`, `vite` (plain dev) or Vitest. See dev/README.md.
 */
async function devHarness(command: string, mode: string): Promise<Plugin[]> {
	if (command !== "serve" || mode !== "harness") return [];
	// Not VITE_-prefixed, so these stay server-side and never reach the client bundle.
	const env = loadEnv(mode, process.cwd(), "");
	if (!env.DATAVERSE_URL) {
		throw new Error(
			"[fxs-harness] Set DATAVERSE_URL=https://<org>.crm.dynamics.com (environment variable or " +
				".env.local) before running `npm run dev:harness`. See dev/README.md.",
		);
	}
	const { dataverseHarness } = await import("./dev/harness/vite-plugin-dataverse-proxy");
	return [
		dataverseHarness({
			orgUrl: env.DATAVERSE_URL,
			callerObjectId: env.DATAVERSE_CALLER_OBJECT_ID,
		}),
	];
}

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => ({
	plugins: [react(), toolIcon(), ...(await devHarness(command, mode))],
	optimizeDeps: {
		// Pre-bundle monaco-editor so Vite doesn't try to transform its deep
		// internal imports at runtime (avoids CJS/ESM interop issues).
		include: ["monaco-editor"],
	},
	build: {
		// Disable source maps in production — Monaco worker maps alone add ~17 MB.
		sourcemap: false,
		rollupOptions: {
			output: {
				// Keep Monaco's large language packs in a separate chunk so the
				// main bundle doesn't balloon unnecessarily.
				manualChunks: {
					"monaco-editor": ["monaco-editor"],
				},
			},
		},
	},
	test: {
		// jsdom provides DOMParser, which the FetchXML parser relies on.
		environment: "jsdom",
		include: ["src/**/*.test.ts", "dev/**/*.test.ts"],
	},
}));
