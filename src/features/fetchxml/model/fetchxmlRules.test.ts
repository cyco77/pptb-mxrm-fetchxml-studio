/**
 * Query-level rules (#90b). Every case mirrors a query executed against a live Dataverse org
 * through the PPTB request path (2026-10-13/14); the expected outcome is what Dataverse did.
 */
import { describe, expect, it } from "vitest";
import { parseFetchXml, getExecutionErrors, type ParseWarning } from "./fetchxmlParser";

const SU = (inner: string, fetchAttrs = "") => `<fetch${fetchAttrs}><entity name="systemuser">${inner}</entity></fetch>`;
const CNT = `<attribute name="systemuserid" alias="n" aggregate="count" />`;
const GRP = `<attribute name="isdisabled" alias="d" groupby="true" />`;
const BU = (inner = "", alias = ` alias="bu"`) =>
	`<link-entity name="businessunit" from="businessunitid" to="businessunitid"${alias}>${inner}</link-entity>`;

const warningsOf = (xml: string): ParseWarning[] => {
	const r = parseFetchXml(xml);
	expect(r.success, r.errors.map((e) => e.message).join("; ")).toBe(true);
	return r.warnings;
};
const errorsOf = (xml: string) => getExecutionErrors({ warnings: warningsOf(xml) });

describe("accepted by Dataverse → no errors", () => {
	it.each([
		["aggregate: group by + count + order by alias", SU(`${GRP}${CNT}<order alias="n" descending="true" />`, ` aggregate="true"`)],
		["aggregate: root order with entityname uses the link's alias", SU(`${CNT}${BU(`<attribute name="name" alias="g" groupby="true" />`)}<order entityname="bu" alias="g" />`, ` aggregate="true"`)],
		["aggregate: order inside the link uses the link's alias", SU(`${CNT}${BU(`<attribute name="name" alias="g" groupby="true" /><order alias="g" />`)}`, ` aggregate="true"`)],
		["aggregate: date grouping + UTC", SU(`<attribute name="createdon" alias="m" groupby="true" dategrouping="day" usertimezone="false" />${CNT}`, ` aggregate="true"`)],
		["aggregate: aggregatelimit without an order", SU(`${GRP}${CNT}`, ` aggregate="true" aggregatelimit="1000"`)],
		["aggregate: all-attributes is accepted", SU(`<all-attributes />${CNT}`, ` aggregate="true"`)],
		["non-aggregate: aggregatelimit + order (ignored)", SU(`<attribute name="fullname" /><order attribute="fullname" />`, ` top="3" aggregatelimit="100"`)],
		["non-aggregate: order entityname = link alias", SU(`<attribute name="fullname" />${BU(`<attribute name="name" />`)}<order entityname="bu" attribute="name" />`)],
		["non-aggregate: order entityname = link name", SU(`<attribute name="fullname" />${BU(`<attribute name="name" />`, "")}<order entityname="businessunit" attribute="name" />`)],
		["non-aggregate: order entityname = root entity name", SU(`<attribute name="fullname" /><order entityname="systemuser" attribute="fullname" />`)],
		["row aggregate on the root primary key with an alias", `<fetch><entity name="account"><attribute name="name" /><attribute name="accountid" rowaggregate="CountChildren" alias="kids" /></entity></fetch>`],
		["row aggregate next to the same attribute without alias (Learn)", `<fetch><entity name="account"><attribute name="accountid" /><attribute name="accountid" rowaggregate="CountChildren" alias="AccountChildren" /></entity></fetch>`],
		["union hint on an or-filter", SU(`<attribute name="fullname" /><filter type="or" hint="union"><condition attribute="isdisabled" operator="eq" value="0" /><condition attribute="isdisabled" operator="eq" value="1" /></filter>`)],
		["quick find with one override", SU(`<attribute name="fullname" /><filter type="or" isquickfindfields="1" overridequickfindrecordlimitdisabled="1"><condition attribute="fullname" operator="like" value="a%" /></filter>`)],
		["alias equal to a link-entity alias", SU(`<attribute name="fullname" alias="bu" />${BU(`<attribute name="name" />`)}`)],
	])("%s", (_label, xml) => {
		expect(errorsOf(xml)).toEqual([]);
	});
});

describe("rejected by Dataverse → error", () => {
	it.each([
		["aggregate: attribute with no role (0x8004111e)", SU(`<attribute name="fullname" alias="f" />${CNT}`, ` aggregate="true"`), "0x8004111e"],
		["aggregate: link attribute with no role (0x8004111e)", SU(`${CNT}${BU(`<attribute name="name" alias="g" />`)}`, ` aggregate="true"`), "0x8004111e"],
		["aggregate: aggregate attribute without alias (0x8004110b)", SU(`<attribute name="systemuserid" aggregate="count" />`, ` aggregate="true"`), "0x8004110b"],
		["aggregate: link group by without alias (0x8004110b)", SU(`${CNT}${BU(`<attribute name="name" groupby="true" />`)}`, ` aggregate="true"`), "0x8004110b"],
		["aggregate: group by and aggregate on one attribute (0x80041137)", SU(`<attribute name="isdisabled" alias="d" groupby="true" aggregate="count" />`, ` aggregate="true"`), "0x80041137"],
		["non-aggregate: aggregate attribute (0x8004111a)", SU(`<attribute name="systemuserid" alias="n" aggregate="count" />`), "0x8004111a"],
		["non-aggregate: group by attribute (0x8004112e)", SU(`<attribute name="isdisabled" alias="d" groupby="true" />`), "0x8004112e"],
		["aggregate: root order alias defined in a link (0x8004110a)", SU(`${CNT}${BU(`<attribute name="name" alias="g" groupby="true" />`)}<order alias="g" />`, ` aggregate="true"`), "0x8004110a"],
		["aggregate: link order alias defined on the root (0x8004110a)", SU(`${GRP}${CNT}${BU(`<attribute name="name" alias="g" groupby="true" /><order alias="d" />`)}`, ` aggregate="true"`), "0x8004110a"],
		["aggregate: order alias that doesn't exist (0x8004110a)", SU(`${GRP}${CNT}<order alias="zzz" />`, ` aggregate="true"`), "0x8004110a"],
		["aggregate: order by attribute (0x80041131)", SU(`${GRP}${CNT}<order attribute="isdisabled" />`, ` aggregate="true"`), "0x80041131"],
		["non-aggregate: order by alias (0x80041132)", SU(`<attribute name="fullname" /><order attribute="fullname" alias="x" />`), "0x80041132"],
		["order entityname matching nothing (0x80041108)", SU(`<attribute name="fullname" /><order entityname="nope" attribute="fullname" />`), "0x80041108"],
		["entityname on an order inside a link (0x80041108)", SU(`<attribute name="fullname" />${BU(`<attribute name="name" /><order entityname="bu" attribute="name" />`)}`), "0x80041108"],
		["aggregate: aggregatelimit + order (SQL error)", SU(`${GRP}${CNT}<order alias="d" />`, ` aggregate="true" aggregatelimit="1000"`), "SQL error"],
		["union hint on an and-filter (0x80041122)", SU(`<attribute name="fullname" /><filter type="and" hint="union"><condition attribute="isdisabled" operator="eq" value="0" /></filter>`), "0x80041122"],
		["two union hints (0x80041122)", SU(`<attribute name="fullname" /><filter><filter type="or" hint="union"><condition attribute="isdisabled" operator="eq" value="0" /></filter><filter type="or" hint="union"><condition attribute="isdisabled" operator="eq" value="1" /></filter></filter>`), "0x80041122"],
		["hint other than 'union' (0x80041122)", SU(`<attribute name="fullname" /><filter type="or" hint="Union"><condition attribute="isdisabled" operator="eq" value="0" /></filter>`), "0x80041122"],
		["row aggregate without alias (SQL error)", `<fetch><entity name="account"><attribute name="accountid" rowaggregate="CountChildren" /></entity></fetch>`, "alias"],
		["row aggregate inside a link-entity", `<fetch><entity name="contact"><attribute name="fullname" /><link-entity name="account" from="accountid" to="parentcustomerid" alias="a"><attribute name="accountid" rowaggregate="CountChildren" alias="kids" /></link-entity></entity></fetch>`, "root entity"],
		["row aggregate in an aggregate query (SQL error)", SU(`<attribute name="systemuserid" alias="k" groupby="true" rowaggregate="CountChildren" />${CNT.replace('alias="n"', 'alias="n2"')}`, ` aggregate="true"`), "aggregate query"],
		["duplicate alias (0x80041130)", SU(`<attribute name="fullname" alias="x" /><attribute name="domainname" alias="x" />`), "0x80041130"],
		["alias differing only in case (0x80041130)", SU(`<attribute name="fullname" alias="x" /><attribute name="domainname" alias="X" />`), "0x80041130"],
		["same alias on root and link attributes (0x80041130)", SU(`<attribute name="fullname" alias="x" />${BU(`<attribute name="name" alias="x" />`)}`), "0x80041130"],
		["alias equal to another root attribute's logical name (0x80041130)", SU(`<attribute name="fullname" alias="domainname" /><attribute name="domainname" />`), "0x80041130"],
		["duplicate link-entity alias (0x80041130)", SU(`<attribute name="fullname" />${BU(`<attribute name="name" />`)}${BU(`<attribute name="name" />`)}`), "0x80041130"],
		["descending='True' (0x80041119)", SU(`<attribute name="fullname" /><order attribute="fullname" descending="True" />`), "0x80041119"],
	])("%s", (_label, xml, needle) => {
		const errors = errorsOf(xml);
		expect(errors.length, "expected an error").toBeGreaterThan(0);
		expect(errors.map((e) => e.message).join(" | ")).toContain(needle);
	});

	it("query-level findings point at the node they're about", () => {
		const r = parseFetchXml(SU(`<attribute name="fullname" alias="f" />${CNT}`, ` aggregate="true"`));
		const finding = getExecutionErrors(r).find((w) => w.message.includes("0x8004111e"))!;
		const node = r.fetchNode!.entity.attributes.find((a) => a.name === "fullname")!;
		expect(finding.nodeId).toBe(node.id);
	});
});

describe("accepted but ignored → info only", () => {
	it.each([
		["aggregatelimit on a non-aggregate query", SU(`<attribute name="fullname" />`, ` aggregatelimit="5"`), "aggregatelimit"],
		["date grouping outside an aggregate query", SU(`<attribute name="createdon" dategrouping="year" alias="y" />`), "dategrouping"],
		["date grouping on an aggregate attribute", SU(`<attribute name="createdon" aggregate="max" dategrouping="year" alias="y" />`, ` aggregate="true"`), "dategrouping"],
		["distinct with an aggregate other than countcolumn", SU(`<attribute name="systemuserid" alias="c" aggregate="count" distinct="true" />`, ` aggregate="true"`), "distinct"],
		["both quick find overrides", SU(`<attribute name="fullname" /><filter type="or" isquickfindfields="1" overridequickfindrecordlimitenabled="1" overridequickfindrecordlimitdisabled="1"><condition attribute="fullname" operator="like" value="%" /></filter>`), "overridequickfindrecordlimitenabled"],
		["aggregate='1' isn't an aggregate query", SU(`<attribute name="fullname" />`, ` aggregate="1"`), "aggregate"],
	])("%s", (_label, xml, attribute) => {
		const warnings = warningsOf(xml);
		expect(getExecutionErrors({ warnings })).toEqual([]);
		expect(warnings.some((w) => w.severity === "info" && w.attribute === attribute)).toBe(true);
	});
});

describe("boolean spellings Dataverse accepts are read correctly", () => {
	const attrOf = (xml: string) => parseFetchXml(xml).fetchNode!.entity.attributes[0];
	it("usertimezone '1' / '0' keep their meaning (was inverted)", () => {
		expect(attrOf(SU(`<attribute name="createdon" alias="d" groupby="true" dategrouping="day" usertimezone="1" />${CNT}`, ` aggregate="true"`)).usertimezone).toBe(true);
		expect(attrOf(SU(`<attribute name="createdon" alias="d" groupby="true" dategrouping="day" usertimezone="0" />${CNT}`, ` aggregate="true"`)).usertimezone).toBe(false);
	});
	it("groupby / distinct / returntotalrecordcount accept '1' and any case", () => {
		expect(attrOf(SU(`<attribute name="isdisabled" alias="d" groupby="1" />${CNT}`, ` aggregate="true"`)).groupby).toBe(true);
		expect(attrOf(SU(`<attribute name="isdisabled" alias="d" groupby="True" />${CNT}`, ` aggregate="true"`)).groupby).toBe(true);
		const f = parseFetchXml(SU(`<attribute name="fullname" />`, ` distinct="1" returntotalrecordcount="TRUE"`)).fetchNode!;
		expect(f.options.distinct).toBe(true);
		expect(f.options.returnTotalRecordCount).toBe(true);
	});
	it("descending '1' sorts descending", () => {
		const o = parseFetchXml(SU(`<attribute name="fullname" /><order attribute="fullname" descending="1" />`)).fetchNode!.entity.orders[0];
		expect(o.descending).toBe(true);
	});
	it("enableprefiltering='1' (the documented form) is kept", () => {
		const e = parseFetchXml(`<fetch><entity name="account" enableprefiltering="1" prefilterparametername="CRM_FilteredAccount"><attribute name="name" /></entity></fetch>`).fetchNode!.entity;
		expect(e.enablePrefiltering).toBe(true);
	});
});
