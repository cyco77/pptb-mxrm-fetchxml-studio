import { describe, expect, it } from "vitest";
import { isValidAlias, sanitizeAlias } from "./aliasUtils";

describe("isValidAlias", () => {
	it("accepts empty (no alias)", () => {
		expect(isValidAlias("")).toBe(true);
	});

	it.each(["a", "_a", "Account_1", "_", "A1b2"])("accepts %s", (alias) => {
		expect(isValidAlias(alias)).toBe(true);
	});

	it.each(["1a", "a-b", "a b", "a.b", "ä", "a$"])("rejects %s", (alias) => {
		expect(isValidAlias(alias)).toBe(false);
	});
});

describe("sanitizeAlias", () => {
	it("strips invalid characters", () => {
		expect(sanitizeAlias("my-alias.name")).toBe("myaliasname");
	});

	it("prefixes a leading digit with an underscore", () => {
		expect(sanitizeAlias("1st")).toBe("_1st");
	});

	it("returns empty string when nothing valid remains", () => {
		expect(sanitizeAlias("-.$")).toBe("");
	});

	it("leaves valid aliases unchanged", () => {
		expect(sanitizeAlias("BR")).toBe("BR");
	});
});
