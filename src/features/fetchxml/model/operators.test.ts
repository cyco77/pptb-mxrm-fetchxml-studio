import { describe, expect, it } from "vitest";
import { ALL_OPERATORS, getOperatorsForAttributeType, operatorRequiresValue } from "./operators";

describe("operatorRequiresValue", () => {
	it.each(["null", "not-null", "today", "eq-userid", "this-fiscal-year"] as const)(
		"%s needs no value",
		(op) => {
			expect(operatorRequiresValue(op)).toBe(false);
		},
	);

	it.each(["eq", "like", "in", "between", "last-x-days", "under"] as const)(
		"%s needs a value",
		(op) => {
			expect(operatorRequiresValue(op)).toBe(true);
		},
	);
});

describe("ALL_OPERATORS", () => {
	it("has no duplicate operator values", () => {
		const values = ALL_OPERATORS.map((o) => o.value);
		expect(new Set(values).size).toBe(values.length);
	});

	it("uses the documented spelling for the negated begins/ends-with operators", () => {
		const values = new Set(ALL_OPERATORS.map((o) => o.value));
		expect(values.has("not-begin-with")).toBe(true);
		expect(values.has("not-end-with")).toBe(true);
	});
});

describe("getOperatorsForAttributeType", () => {
	it("offers string operators for String attributes", () => {
		const ops = getOperatorsForAttributeType("String").map((o) => o.value);
		expect(ops).toContain("like");
		expect(ops).toContain("begins-with");
	});

	it("does not offer string operators for Integer attributes", () => {
		const ops = getOperatorsForAttributeType("Integer").map((o) => o.value);
		expect(ops).not.toContain("like");
		expect(ops).toContain("between");
	});
});
