/**
 * Saved view helpers (#93): system views (savedquery) and personal views (userquery).
 * Pure functions only, so the load / execute / save rules can be unit tested.
 */

import { getParseToTreeChanges, type ParseResult } from "./fetchxmlParser";

/**
 * Whether the query about to run is the loaded view, unmodified, so it can run by its ID
 * (?savedQuery= / ?userQuery=), which pages with @odata.nextLink.
 * https://learn.microsoft.com/power-apps/developer/data-platform/webapi/retrieve-and-execute-predefined-queries
 *
 * Both sides must be generated from a tree (generateFetchXml): the view's stored FetchXML carries
 * version / mapping / descending="false" and other defaults the generator leaves out, so comparing
 * the stored text with generated text never matched (#93).
 */
export function isUnmodifiedView(currentFetchXml: string, viewFetchXml: string): boolean {
	return currentFetchXml.trim() === viewFetchXml.trim();
}

export interface ViewLoadNotice {
	title: string;
	body: string;
	type: "warning" | "error";
}

/**
 * What to tell the user after loading a view's FetchXML into the tree (#93): nothing when it loaded
 * as-is, an error when it couldn't be parsed, a warning listing what the tree changed (saving the
 * view would save those changes).
 */
export function getViewLoadNotice(viewName: string, result: ParseResult): ViewLoadNotice | null {
	if (!result.success) {
		const reason = result.errors[0]?.message;
		return {
			title: "Could not load view",
			body: `The FetchXML of "${viewName}" couldn't be parsed${reason ? `: ${reason}` : "."}`,
			type: "error",
		};
	}
	const changes = getParseToTreeChanges(result);
	if (changes.length === 0) return null;
	const list = changes.map((c) => (c.element ? `<${c.element}> ${c.message}` : c.message)).join(" ");
	return {
		title: "View loaded with changes",
		body: `The tree can't represent everything in "${viewName}". ${list} Saving the view saves these changes.`,
		type: "warning",
	};
}
