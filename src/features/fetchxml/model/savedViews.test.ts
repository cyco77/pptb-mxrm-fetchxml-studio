import { describe, expect, it } from "vitest";
import { parseFetchXml } from "./fetchxmlParser";
import { generateFetchXml } from "./fetchxml";
import { getViewLoadNotice, isUnmodifiedView } from "./savedViews";

/** FetchXML as Dataverse stores it for a system view: legacy attributes and spelled-out defaults. */
const STORED_VIEW_FETCHXML = `<fetch version="1.0" output-format="xml-platform" mapping="logical" distinct="false">
  <entity name="account">
    <attribute name="name" />
    <attribute name="primarycontactid" />
    <attribute name="accountid" />
    <order attribute="name" descending="false" />
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0" />
    </filter>
    <link-entity name="contact" from="contactid" to="primarycontactid" visible="false" link-type="outer" alias="pc">
      <attribute name="emailaddress1" />
    </link-entity>
  </entity>
</fetch>`;

/** What the builder does on Load View: parse, then keep the generated form for comparison. */
function loadView(xml: string) {
	const result = parseFetchXml(xml);
	if (!result.success || !result.fetchNode) throw new Error("parse failed");
	return { fetchNode: result.fetchNode, originalFetchXml: generateFetchXml(result.fetchNode) };
}

describe("isUnmodifiedView (#93)", () => {
	it("matches an unmodified loaded view, so it runs by its ID", () => {
		const view = loadView(STORED_VIEW_FETCHXML);
		// AppShell executes generateFetchXml(builder.fetchQuery)
		expect(isUnmodifiedView(generateFetchXml(view.fetchNode), view.originalFetchXml)).toBe(true);
	});

	it("never matched the stored text (the bug): the generator drops its defaults", () => {
		const view = loadView(STORED_VIEW_FETCHXML);
		expect(isUnmodifiedView(generateFetchXml(view.fetchNode), STORED_VIEW_FETCHXML)).toBe(false);
	});

	it("doesn't match once the query changes", () => {
		const view = loadView(STORED_VIEW_FETCHXML);
		const modified = loadView(STORED_VIEW_FETCHXML.replace('value="0"', 'value="1"'));
		expect(isUnmodifiedView(generateFetchXml(modified.fetchNode), view.originalFetchXml)).toBe(false);
	});

	it("tells whitespace inside values apart", () => {
		expect(isUnmodifiedView('<condition value="a b" />', '<condition value="ab" />')).toBe(false);
		expect(isUnmodifiedView("<fetch />\n", "<fetch />")).toBe(true);
	});
});

describe("getViewLoadNotice (#93)", () => {
	it("says nothing when the view loads as-is", () => {
		expect(getViewLoadNotice("Active Accounts", parseFetchXml(STORED_VIEW_FETCHXML))).toBeNull();
	});

	it("reports a view whose FetchXML can't be parsed", () => {
		const notice = getViewLoadNotice("Broken", parseFetchXml("<fetch><entity name='account'>"));
		expect(notice?.type).toBe("error");
		expect(notice?.body).toContain('"Broken"');
	});

	it("lists what the tree changed", () => {
		const result = parseFetchXml(
			`<fetch><entity name="account"><attribute name="name" alias="1bad" /></entity></fetch>`,
		);
		const notice = getViewLoadNotice("Aliased", result);
		expect(notice?.type).toBe("warning");
		expect(notice?.body).toContain("<attribute>");
		expect(notice?.body).toContain("Saving the view saves these changes.");
	});
});
