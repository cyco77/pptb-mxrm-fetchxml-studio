/**
 * Parser severity classification (#89, #48).
 *
 * Principle: what the FetchXML reference documents is supported; undocumented behaviour verified
 * to work is supported too; only what is known not to work is blocked (error); what can't be
 * determined client-side is a warning with "Execute anyway".
 *
 * Each case mirrors a probe run against a live Dataverse org through the PPTB host request path
 * (2026-10-13). The comment on each case records what Dataverse did with the raw FetchXML.
 */
import { describe, expect, it } from "vitest";
import {
	getBlockingWarnings,
	getExecutionErrors,
	getParseToTreeChanges,
	parseFetchXml,
	type ParseWarning,
} from "./fetchxmlParser";

const wrap = (inner: string, fetchAttrs = "") =>
	`<fetch top="1"${fetchAttrs}><entity name="account"><attribute name="name" />${inner}</entity></fetch>`;
const withAttribute = (attributeXml: string) =>
	wrap("").replace('<attribute name="name" />', attributeXml);

function findings(xml: string) {
	const result = parseFetchXml(xml);
	return {
		result,
		errors: getExecutionErrors(result),
		warnings: getBlockingWarnings(result),
		changes: getParseToTreeChanges(result),
		only: (pred: (w: ParseWarning) => boolean) => result.warnings.filter(pred),
	};
}

describe("supported: documented, or undocumented but verified to work", () => {
	it("#48: xmlns:generator is ignored, never blocks, and changes nothing on Parse to Tree", () => {
		// Dataverse: ✅ runs
		const f = findings(`<fetch xmlns:generator="MarkMpn.SQL4CDS"><entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.result.success).toBe(true);
		expect(f.result.warnings).toEqual([
			expect.objectContaining({ attribute: "xmlns:generator", severity: "info", kind: "ignored" }),
		]);
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([]);
		expect(f.changes).toEqual([]);
	});

	it.each([
		["fetch", `<fetch top="1" foo="1"><entity name="account"><attribute name="name" /></entity></fetch>`],
		["entity", `<fetch top="1"><entity name="account" bogus="x"><attribute name="name" /></entity></fetch>`],
		["attribute", withAttribute('<attribute name="name" bogus="x" />')],
		["filter", wrap(`<filter type="and" bogus="x"><condition attribute="statecode" operator="eq" value="0" /></filter>`)],
		["link-entity", wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" bogus="x" />`)],
	])("unknown attribute on <%s> is a note (Dataverse ignores it)", (element, xml) => {
		const f = findings(xml);
		expect(f.result.success).toBe(true);
		expect(f.only((w) => w.element === element)).toEqual([
			expect.objectContaining({ attribute: expect.stringMatching(/^(foo|bogus)$/), severity: "info", kind: "ignored" }),
		]);
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([]);
		expect(f.changes).toEqual([]);
	});

	it("namespaced attribute is a note (Dataverse ignores it)", () => {
		const f = findings(`<fetch top="1" xmlns:x="urn:x"><entity name="account" x:note="hi"><attribute name="name" /></entity></fetch>`);
		expect(f.only((w) => w.attribute === "x:note")).toEqual([
			expect.objectContaining({ severity: "info", kind: "ignored" }),
		]);
		expect(f.errors).toEqual([]);
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
		["datasource", ` datasource="retained"`],
	])("documented '%s' never blocks; Parse to Tree asks before dropping it", (attr, fetchAttrs) => {
		// Dataverse: ✅ accepts (datasource errors only where long-term retention isn't provisioned)
		const f = findings(wrap("", fetchAttrs));
		expect(f.only((w) => w.attribute === attr)).toEqual([
			expect.objectContaining({ severity: "info", kind: "dropped" }),
		]);
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([]);
		expect(f.changes.map((w) => w.attribute)).toEqual([attr]);
	});

	it("order by alias never blocks and isn't turned into an invalid order", () => {
		// Dataverse: ✅ accepts <order alias> in aggregate queries
		const f = findings(
			`<fetch aggregate="true"><entity name="task"><attribute name="prioritycode" alias="p" groupby="true" /><attribute name="activityid" alias="n" aggregate="count" /><order alias="n" descending="true" /></entity></fetch>`,
		);
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([]);
		expect(f.changes).toEqual([expect.objectContaining({ element: "order", kind: "dropped" })]);
		expect(f.result.fetchNode!.entity.orders).toEqual([]);
	});

	it("link-type 'natural' (undocumented, verified to work) is supported and preserved", () => {
		const f = findings(wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" link-type="natural" alias="c" />`));
		expect(f.result.warnings).toEqual([]);
		expect(f.result.fetchNode!.entity.links[0].linkType).toBe("natural");
	});

	it("deprecated operator 'neq' is supported with advice", () => {
		// Dataverse: ✅ runs
		const f = findings(wrap(`<filter><condition attribute="statecode" operator="neq" value="1" /></filter>`));
		expect(f.result.warnings).toEqual([expect.objectContaining({ severity: "info", kind: "advice" })]);
	});

	it("documented fiscal 'x' operators are supported", () => {
		const f = findings(wrap(`<filter><condition attribute="createdon" operator="last-x-fiscal-years" value="2" /></filter>`));
		expect(f.result.warnings).toEqual([]);
	});

	it("top above 5,000 runs, with advice that Dataverse caps it", () => {
		// Dataverse: ✅ top="6000" returns 5,000 rows
		const f = findings(`<fetch top="6000"><entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.result.warnings).toEqual([expect.objectContaining({ attribute: "top", severity: "info", kind: "advice" })]);
		expect(f.changes).toEqual([]);
	});

	it("non-integer utc-offset is a note (Dataverse ignores it)", () => {
		const f = findings(wrap("", ` utc-offset="abc"`));
		expect(f.result.warnings).toEqual([expect.objectContaining({ severity: "info", kind: "ignored" })]);
	});

	it("extra <entity> elements: Dataverse uses the first; Parse to Tree asks before dropping", () => {
		// Dataverse: ✅ runs
		const f = findings(`<fetch top="1"><entity name="account"><attribute name="name" /></entity><entity name="contact" /></fetch>`);
		expect(f.errors).toEqual([]);
		expect(f.changes).toEqual([expect.objectContaining({ element: "fetch", kind: "dropped" })]);
	});

	it("link-entity alias with a dot is a note (Dataverse accepts it; Parse to Tree tidies it)", () => {
		const f = findings(wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" alias="a.b" />`));
		expect(f.only((w) => w.element === "link-entity")).toEqual([
			expect.objectContaining({ attribute: "alias", severity: "info", kind: "corrected" }),
		]);
		expect(f.errors).toEqual([]);
		expect(f.changes).toEqual([]);
		expect(f.result.fetchNode!.entity.links[0].alias).toBe("ab");
	});
});

describe("errors: known to be rejected by Dataverse (Execute blocked)", () => {
	it.each([
		// [label, xml, expected kind, Dataverse error]
		["unknown child element", wrap("<foo />"), "dropped"], // 0x8004111c
		["namespaced child element", `<fetch top="1" xmlns:x="urn:x"><entity name="account"><attribute name="name" /><x:meta /></entity></fetch>`, "dropped"], // 0x8004111c
		["attribute alias 'my name'", withAttribute('<attribute name="name" alias="my name" />'), "corrected"], // 0x80041109
		["attribute alias 'my-name'", withAttribute('<attribute name="name" alias="my-name" />'), "corrected"], // 0x80041109
		["attribute alias '1name'", withAttribute('<attribute name="name" alias="1name" />'), "corrected"], // 0x80041109
		["non-integer top", `<fetch top="abc"><entity name="account"><attribute name="name" /></entity></fetch>`, "dropped"], // Input string was not in a correct format
		["unknown link-type", wrap(`<link-entity name="contact" from="parentcustomerid" to="accountid" link-type="bogus" alias="c" />`), "corrected"], // 0x80041117
		["attribute without name", withAttribute("<attribute />"), "invalid"], // 0x8004111e
		["condition without attribute", wrap(`<filter><condition operator="eq" value="x" /></filter>`), "invalid"], // 0x8004111e
		["condition without operator", wrap(`<filter><condition attribute="name" value="x" /></filter>`), "corrected"], // 0x8004111e
		["order with neither attribute nor alias", wrap(`<order descending="true" />`), "dropped"], // 0x80041133
		["default xmlns", `<fetch xmlns="urn:test"><entity name="account"><attribute name="name" /></entity></fetch>`, "corrected"], // 0x80041102
		["invalid filter type", wrap(`<filter type="xor"><condition attribute="statecode" operator="eq" value="0" /></filter>`), "corrected"], // 0x80041122
		["link-entity without name", wrap(`<link-entity from="parentcustomerid" to="accountid" alias="c" />`), "invalid"], // 0x8004111e
		["invalid aggregate", `<fetch aggregate="true"><entity name="account"><attribute name="accountid" alias="n" aggregate="median" /></entity></fetch>`, "dropped"], // 0x8004111a
		["invalid dategrouping", `<fetch aggregate="true"><entity name="account"><attribute name="createdon" alias="d" groupby="true" dategrouping="decade" /></entity></fetch>`, "dropped"], // 0x80041135
	])("%s", (_label, xml, kind) => {
		const f = findings(xml);
		expect(f.result.success).toBe(true); // Parse to Tree can still build a tree
		expect(f.errors).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", kind })]));
	});

	it.each([
		["count", `<fetch top="5" count="5">`],
		["page", `<fetch top="5" page="2">`],
		["returntotalrecordcount", `<fetch top="5" returntotalrecordcount="true">`],
	])("top combined with %s is an error (0x80040203)", (_label, fetchTag) => {
		const f = findings(`${fetchTag}<entity name="account"><attribute name="name" /></entity></fetch>`);
		expect(f.errors).toEqual([expect.objectContaining({ attribute: "top", kind: "invalid" })]);
	});

	it("errors that Parse to Tree corrects or drops are listed as changes", () => {
		const f = findings(withAttribute('<attribute name="name" alias="my name" />'));
		expect(f.changes).toEqual([expect.objectContaining({ attribute: "alias", kind: "corrected" })]);
	});
});

describe("warnings: can't be determined client-side (Execute anyway)", () => {
	it("link-entity without from/to (valid only for system many-to-many relationships)", () => {
		// Dataverse: ❌ contact→account (N:1), ✅ systemuser→team (system N:N)
		const f = findings(`<fetch top="1"><entity name="contact"><attribute name="fullname" /><link-entity name="account" alias="a" /></entity></fetch>`);
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([expect.objectContaining({ element: "link-entity", kind: "invalid" })]);
	});

	it("operator not in the documented list (Microsoft may add operators)", () => {
		// Dataverse: ❌ 0x80041120 for 'bogus'
		const f = findings(wrap(`<filter><condition attribute="name" operator="bogus" value="x" /></filter>`));
		expect(f.errors).toEqual([]);
		expect(f.warnings).toEqual([expect.objectContaining({ attribute: "operator", kind: "invalid" })]);
	});
});

describe("fatal: no usable tree", () => {
	it("link-entity with empty from and to (Dataverse silently returns 0 rows)", () => {
		const r = parseFetchXml(
			`<fetch top="2"><entity name="contact"><attribute name="fullname" /><link-entity name="account" from="" to="" alias="a" /></entity></fetch>`,
		);
		expect(r.success).toBe(false);
		expect(r.errors[0].message).toMatch(/empty 'from' and 'to'/);
	});
});
