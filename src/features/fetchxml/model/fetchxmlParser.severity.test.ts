/**
 * Parser severity classification (#89, #48).
 *
 * Each case mirrors a probe run against a live Dataverse org through the PPTB host request path
 * (2026-10-13). The comment on each case records what Dataverse did with the raw FetchXML.
 */
import { describe, expect, it } from "vitest";
import {
	getBlockingWarnings,
	getParseToTreeChanges,
	parseFetchXml,
	type ParseWarning,
} from "./fetchxmlParser";

const wrap = (inner: string, fetchAttrs = "") =>
	`<fetch top="1"${fetchAttrs}><entity name="account"><attribute name="name" />${inner}</entity></fetch>`;

function findings(xml: string) {
	const result = parseFetchXml(xml);
	return {
		result,
		blocking: getBlockingWarnings(result),
		changes: getParseToTreeChanges(result),
		only: (pred: (w: ParseWarning) => boolean) => result.warnings.filter(pred),
	};
}

describe("non-blocking findings (Dataverse accepts or ignores)", () => {
	it("#48: xmlns:generator is ignored, not blocking, and changes nothing on Parse to Tree", () => {
		// Dataverse: ✅ runs
		const f = findings(`<fetch xmlns:generator="MarkMpn.SQL4CDS"><entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.result.success).toBe(true);
		expect(f.result.warnings).toEqual([
			expect.objectContaining({ attribute: "xmlns:generator", severity: "info", kind: "ignored" }),
		]);
		expect(f.blocking).toEqual([]);
		expect(f.changes).toEqual([]);
	});

	it.each([
		["fetch", `<fetch top="1" foo="1"><entity name="account"><attribute name="name" /></entity></fetch>`],
		["entity", `<fetch top="1"><entity name="account" bogus="x"><attribute name="name" /></entity></fetch>`],
		["attribute", wrap("").replace('<attribute name="name" />', '<attribute name="name" bogus="x" />')],
		["filter", wrap(`<filter type="and" bogus="x"><condition attribute="statecode" operator="eq" value="0" /></filter>`)],
		["link-entity", wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" bogus="x" />`)],
	])("unknown attribute on <%s> is info/ignored", (element, xml) => {
		// Dataverse: ✅ ignores unknown attributes on fetch, entity, attribute, filter, link-entity
		const f = findings(xml);
		expect(f.result.success).toBe(true);
		expect(f.only((w) => w.element === element)).toEqual([
			expect.objectContaining({ attribute: expect.stringMatching(/^(foo|bogus)$/), severity: "info", kind: "ignored" }),
		]);
		expect(f.blocking).toEqual([]);
		expect(f.changes).toEqual([]);
	});

	it("namespaced attribute on an element is info/ignored", () => {
		// Dataverse: ✅ ignores x:note
		const f = findings(`<fetch top="1" xmlns:x="urn:x"><entity name="account" x:note="hi"><attribute name="name" /></entity></fetch>`);
		expect(f.only((w) => w.attribute === "x:note")).toEqual([
			expect.objectContaining({ severity: "info", kind: "ignored" }),
		]);
		expect(f.blocking).toEqual([]);
	});

	it("legacy Advanced Find / saved-view attributes are accepted silently", () => {
		// Dataverse: ✅ ignores version/output-format/mapping and condition uiname/uitype
		const f = findings(
			`<fetch version="1.0" output-format="xml-platform" mapping="logical" top="1"><entity name="account"><attribute name="name" />` +
				`<filter type="and"><condition attribute="ownerid" operator="ne" value="{00000000-0000-0000-0000-000000000001}" uiname="x" uitype="systemuser" /></filter>` +
				`</entity></fetch>`,
		);
		expect(f.result.warnings).toEqual([]);
	});

	it.each([
		["useraworderby", ` useraworderby="1"`],
		["aggregatelimit", ` aggregatelimit="1000"`],
		["latematerialize", ` latematerialize="true"`],
		["options", ` options="HashJoin"`],
	])("documented but not yet modelled '%s' is info/dropped (shown before Parse to Tree)", (attr, fetchAttrs) => {
		// Dataverse: ✅ accepts all four
		const f = findings(wrap("", fetchAttrs));
		expect(f.only((w) => w.attribute === attr)).toEqual([
			expect.objectContaining({ severity: "info", kind: "dropped" }),
		]);
		expect(f.blocking).toEqual([]);
		expect(f.changes.map((w) => w.attribute)).toEqual([attr]);
	});

	it("order by alias is info/dropped and not turned into an invalid order", () => {
		// Dataverse: ✅ accepts <order alias> in aggregate queries
		const f = findings(
			`<fetch aggregate="true"><entity name="task"><attribute name="prioritycode" alias="p" groupby="true" /><attribute name="activityid" alias="n" aggregate="count" /><order alias="n" descending="true" /></entity></fetch>`,
		);
		expect(f.blocking).toEqual([]);
		expect(f.changes).toEqual([expect.objectContaining({ element: "order", kind: "dropped" })]);
		expect(f.result.fetchNode!.entity.orders).toEqual([]);
	});

	it("link-entity alias with a dot is info/corrected", () => {
		// Dataverse: ✅ accepts alias 'a.b', but dotted aliases make result columns ambiguous
		const f = findings(wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" alias="a.b" />`));
		expect(f.only((w) => w.element === "link-entity")).toEqual([
			expect.objectContaining({ attribute: "alias", severity: "info", kind: "corrected" }),
		]);
		expect(f.blocking).toEqual([]);
		expect(f.changes).toEqual([]);
		expect(f.result.fetchNode!.entity.links[0].alias).toBe("ab");
	});
});

describe("warnings (Dataverse rejects the query as written)", () => {
	it.each([
		["unknown child element", wrap("<foo />"), "foo"],
		["namespaced child element", `<fetch top="1" xmlns:x="urn:x"><entity name="account"><attribute name="name" /><x:meta /></entity></fetch>`, "x:meta"],
	])("%s is a warning (0x8004111c)", (_label, xml, element) => {
		const f = findings(xml);
		expect(f.blocking).toEqual([expect.objectContaining({ element, severity: "warning", kind: "dropped" })]);
	});

	it.each(["my name", "my-name", "1name"])("attribute alias '%s' is a warning (0x80041109)", (alias) => {
		const f = findings(wrap("").replace('<attribute name="name" />', `<attribute name="name" alias="${alias}" />`));
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "alias", kind: "corrected" })]);
	});

	it("non-integer top is a warning", () => {
		// Dataverse: ❌ "Input string was not in a correct format"
		const f = findings(`<fetch top="abc"><entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "top" })]);
	});

	it("invalid link-type is a warning (0x80041117)", () => {
		const f = findings(wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" link-type="bogus" alias="c" />`));
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "link-type", kind: "corrected" })]);
	});

	it("unknown operator is a warning (0x80041120)", () => {
		const f = findings(wrap(`<filter><condition attribute="name" operator="bogus" value="x" /></filter>`));
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "operator", kind: "invalid" })]);
	});

	it("documented fiscal 'x' operators are not reported as unknown", () => {
		const f = findings(wrap(`<filter><condition attribute="createdon" operator="last-x-fiscal-years" value="2" /></filter>`));
		expect(f.result.warnings).toEqual([]);
	});

	it.each([
		["attribute without name", wrap("").replace('<attribute name="name" />', "<attribute />")], // 0x8004111e
		["condition without attribute", wrap(`<filter><condition operator="eq" value="x" /></filter>`)], // 0x8004111e
		["order with neither attribute nor alias", wrap(`<order descending="true" />`)], // 0x80041133
	])("%s is a warning", (_label, xml) => {
		expect(findings(xml).blocking).toHaveLength(1);
	});

	it("link-entity missing from/to is a warning (only system N:N can be inferred)", () => {
		// Dataverse: ❌ 0x80041102 for contact→account without from/to
		const f = findings(`<fetch top="1"><entity name="contact"><attribute name="fullname" /><link-entity name="account" alias="a" /></entity></fetch>`);
		expect(f.blocking).toEqual([expect.objectContaining({ element: "link-entity", kind: "invalid" })]);
	});

	it("default xmlns on fetch is a warning (0x80041102)", () => {
		const f = findings(`<fetch xmlns="urn:test"><entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "xmlns", kind: "corrected" })]);
	});

	it("datasource is a warning: dropping it would read live instead of retained data", () => {
		const f = findings(wrap("", ` datasource="retained"`));
		expect(f.blocking).toEqual([expect.objectContaining({ attribute: "datasource", kind: "dropped" })]);
	});
});

describe("errors (query unusable)", () => {
	it("link-entity with empty from and to is an error (Dataverse silently returns 0 rows)", () => {
		const r = parseFetchXml(
			`<fetch top="2"><entity name="contact"><attribute name="fullname" /><link-entity name="account" from="" to="" alias="a" /></entity></fetch>`,
		);
		expect(r.success).toBe(false);
		expect(r.errors[0].message).toMatch(/empty 'from' and 'to'/);
	});
});
