import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionGuard, getPrimaryConnection } from "./host";

// Host APIs are feature-detected, so older hosts (and the dev server) degrade gracefully

const setToolbox = (api: unknown) => ((window as unknown as { toolboxAPI?: unknown }).toolboxAPI = api);
const connection = (id: string, url: string) => ({ id, url, name: id, environment: "Dev" as const });

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	delete (window as unknown as { toolboxAPI?: unknown }).toolboxAPI;
});

describe("getPrimaryConnection", () => {
	it("uses the slot-aware getConnection(0) when the host has it (PPTB ≥ 1.2.7)", async () => {
		const getConnection = vi.fn(async () => connection("a", "https://a.crm.dynamics.com"));
		const getActiveConnection = vi.fn();
		setToolbox({ connections: { getConnection, getActiveConnection } });
		expect((await getPrimaryConnection())?.id).toBe("a");
		expect(getConnection).toHaveBeenCalledWith(0);
		expect(getActiveConnection).not.toHaveBeenCalled();
	});

	it("falls back to getActiveConnection, and to null without a host", async () => {
		setToolbox({ connections: { getActiveConnection: async () => connection("b", "https://b") } });
		expect((await getPrimaryConnection())?.id).toBe("b");
		setToolbox(undefined);
		expect(await getPrimaryConnection()).toBeNull();
	});
});

describe("connectionGuard (#66)", () => {
	it("says no once the tool's connection changes", async () => {
		let current = connection("a", "https://a.crm.dynamics.com/");
		setToolbox({ connections: { getConnection: async () => current } });
		const stillOnConnection = await connectionGuard();
		expect(await stillOnConnection()).toBe(true);
		current = { ...connection("a", "https://a.crm.dynamics.com"), name: "renamed" };
		expect(await stillOnConnection()).toBe(true);
		current = connection("b", "https://b.crm.dynamics.com");
		expect(await stillOnConnection()).toBe(false);
	});
});
