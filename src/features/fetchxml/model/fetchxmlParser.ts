/**
 * FetchXML Parser - Convert FetchXML string to FetchNode tree
 * Strict XML syntax validation, lenient schema validation (warnings)
 */

import type {
	FetchNode,
	EntityNode,
	AttributeNode,
	AllAttributesNode,
	OrderNode,
	FilterNode,
	ConditionNode,
	LinkEntityNode,
	LinkType,
	OperatorType,
	NodeId,
} from "./nodes";
import { isValidAlias, sanitizeAlias } from "./aliasUtils";
import { ALL_OPERATORS } from "./operators";

// ID generator for parsed nodes
let parseIdCounter = 0;
const generateParseId = (): NodeId => `parsed_${++parseIdCounter}`;

/**
 * Reset the ID counter (useful for testing)
 */
export function resetParserIdCounter(): void {
	parseIdCounter = 0;
}

/**
 * Parsing result with optional warnings
 */
export interface ParseResult {
	success: boolean;
	fetchNode?: FetchNode;
	errors: ParseError[];
	warnings: ParseWarning[];
}

export interface ParseError {
	message: string;
	line?: number;
	column?: number;
}

/**
 * How serious a parser finding is (#89):
 *  - "warning": Dataverse is expected to reject the query as written (verified against a live org);
 *    the editor shows it and offers "Execute anyway".
 *  - "info": never blocks — Dataverse ignores or accepts it, but the user should know (e.g. what
 *    Parse to Tree will drop).
 * Problems that make the query unusable are reported in `errors` instead.
 */
export type ParseWarningSeverity = "warning" | "info";

/**
 * What happens to the finding:
 *  - "invalid":   the query is invalid as written (Dataverse rejects it)
 *  - "ignored":   Dataverse ignores it; Parse to Tree drops it with no change in results
 *  - "dropped":   meaningful, but the tree can't represent it yet — Parse to Tree removes it
 *  - "corrected": Parse to Tree changes it to a valid form (e.g. sanitized alias)
 */
export type ParseWarningKind = "invalid" | "ignored" | "dropped" | "corrected";

export interface ParseWarning {
	message: string;
	element?: string;
	attribute?: string;
	severity: ParseWarningSeverity;
	kind: ParseWarningKind;
}

/** Internal: a finding that may also be a hard error (moved to `errors` when parsing finishes). */
type ParseIssue = Omit<ParseWarning, "severity"> & { severity: ParseWarningSeverity | "error" };

/** Warnings that Dataverse is expected to reject — the editor asks before executing. */
export function getBlockingWarnings(result: Pick<ParseResult, "warnings">): ParseWarning[] {
	return result.warnings.filter((w) => w.severity === "warning");
}

/**
 * Changes Parse to Tree would make to the query: anything it drops, and anything it rewrites to fix
 * a problem Dataverse would reject. Ignored items (Dataverse ignores them too) and minor
 * informational corrections are not changes; invalid items are kept as written.
 */
export function getParseToTreeChanges(result: Pick<ParseResult, "warnings">): ParseWarning[] {
	return result.warnings.filter(
		(w) => w.kind === "dropped" || (w.kind === "corrected" && w.severity === "warning"),
	);
}

const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Documented condition operators. https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/reference/operators */
const KNOWN_OPERATORS: ReadonlySet<string> = new Set<string>([
	...ALL_OPERATORS.map((o) => o.value),
	// Documented, but not yet selectable in the UI (#87)
	"last-x-fiscal-periods",
	"last-x-fiscal-years",
	"next-x-fiscal-periods",
	"next-x-fiscal-years",
	// Deprecated alias of "ne", still accepted
	"neq",
]);

/**
 * Attributes Dataverse ignores that are ubiquitous in FetchXML exported from Advanced Find and
 * saved views. Reporting them on every paste would be noise, so they are accepted silently.
 */
const SILENT_LEGACY_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
	fetch: new Set(["version", "output-format", "mapping", "min-active-row-version"]),
	condition: new Set(["uiname", "uitype", "uihidden"]),
};

/**
 * Per element: attributes the tree model reads and writes, and documented attributes it can't
 * hold yet (#90). Source: https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/reference/
 */
const ELEMENT_ATTRIBUTES: Record<
	string,
	{ modelled: ReadonlySet<string>; unmodelled: ReadonlySet<string> }
> = {
	fetch: {
		modelled: new Set([
			"aggregate",
			"distinct",
			"top",
			"count",
			"page",
			"paging-cookie",
			"returntotalrecordcount",
			"no-lock",
			"utc-offset",
		]),
		unmodelled: new Set(["aggregatelimit", "datasource", "latematerialize", "options", "useraworderby"]),
	},
	entity: {
		modelled: new Set(["name"]),
		unmodelled: new Set(["enableprefiltering", "prefilterparametername"]),
	},
	attribute: {
		modelled: new Set(["name", "alias", "groupby", "aggregate", "dategrouping", "usertimezone"]),
		unmodelled: new Set(["distinct", "rowaggregate"]),
	},
	order: {
		modelled: new Set(["attribute", "descending", "entityname"]),
		unmodelled: new Set(["alias"]),
	},
	filter: {
		modelled: new Set(["type", "hint"]),
		unmodelled: new Set([
			"isquickfindfields",
			"overridequickfindrecordlimitenabled",
			"overridequickfindrecordlimitdisabled",
		]),
	},
	condition: {
		modelled: new Set(["attribute", "entityname", "operator", "value", "valueof", "aggregate"]),
		unmodelled: new Set(),
	},
	"link-entity": {
		modelled: new Set(["name", "from", "to", "alias", "link-type", "intersect", "visible"]),
		unmodelled: new Set(),
	},
};

/**
 * Report attributes on an element that the tree won't keep: namespace declarations, namespaced
 * attributes, documented-but-unsupported attributes, and unknown attributes.
 * Live-validated: Dataverse ignores unknown and namespaced attributes, but rejects a default
 * namespace on <fetch> (0x80041102).
 */
function reportElementAttributes(el: Element, elementName: string, issues: ParseIssue[]): void {
	const lists = ELEMENT_ATTRIBUTES[elementName];
	if (!lists) return;
	const silent = SILENT_LEGACY_ATTRIBUTES[elementName];

	for (const attr of Array.from(el.attributes)) {
		const name = attr.name;
		const lower = name.toLowerCase();

		if (lower === "xmlns") {
			issues.push({
				message: `Default namespace (xmlns="${attr.value}") isn't supported by Dataverse; Parse to Tree removes it.`,
				element: elementName,
				attribute: name,
				severity: "warning",
				kind: "corrected",
			});
			continue;
		}
		if (attr.namespaceURI === XMLNS_NAMESPACE || lower.startsWith("xmlns:")) {
			issues.push({
				message: `Namespace declaration '${name}' is ignored by Dataverse.`,
				element: elementName,
				attribute: name,
				severity: "info",
				kind: "ignored",
			});
			continue;
		}
		if (attr.namespaceURI) {
			issues.push({
				message: `Namespaced attribute '${name}' is ignored by Dataverse; Parse to Tree drops it.`,
				element: elementName,
				attribute: name,
				severity: "info",
				kind: "ignored",
			});
			continue;
		}
		if (lists.modelled.has(lower) || silent?.has(lower)) continue;

		if (lists.unmodelled.has(lower)) {
			const changesDataSource = elementName === "fetch" && lower === "datasource";
			issues.push({
				message: changesDataSource
					? `'${name}="${attr.value}"' isn't supported in the tree yet; Parse to Tree drops it, so the query would read live data instead.`
					: `'${name}' is supported by Dataverse but not by the tree yet; Parse to Tree drops it.`,
				element: elementName,
				attribute: name,
				severity: changesDataSource ? "warning" : "info",
				kind: "dropped",
			});
			continue;
		}

		issues.push({
			message: `Unknown attribute '${name}' is ignored by Dataverse; Parse to Tree drops it.`,
			element: elementName,
			attribute: name,
			severity: "info",
			kind: "ignored",
		});
	}
}

/** Unknown child element (including namespaced ones): Dataverse rejects it (0x8004111c). */
function reportUnknownChild(child: Element, parentName: string, issues: ParseIssue[]): void {
	issues.push({
		message: `Unknown element <${child.nodeName}> inside <${parentName}> isn't valid FetchXML (Dataverse rejects it); Parse to Tree drops it.`,
		element: child.nodeName,
		severity: "warning",
		kind: "dropped",
	});
}

/**
 * Main entry point: Parse FetchXML string to FetchNode
 */
export function parseFetchXml(xmlString: string): ParseResult {
	const issues: ParseIssue[] = [];

	// Validate input
	if (!xmlString || typeof xmlString !== "string") {
		return {
			success: false,
			errors: [{ message: "FetchXML string is required" }],
			warnings: [],
		};
	}

	const trimmedXml = xmlString.trim();
	if (!trimmedXml) {
		return {
			success: false,
			errors: [{ message: "FetchXML string is empty" }],
			warnings: [],
		};
	}

	// Parse XML using DOMParser
	let doc: Document;
	try {
		const parser = new DOMParser();
		doc = parser.parseFromString(trimmedXml, "application/xml");

		// Check for parsing errors
		const parserError = doc.querySelector("parsererror");
		if (parserError) {
			// Extract error message from parsererror element
			const errorText = parserError.textContent || "Invalid XML syntax";
			return {
				success: false,
				errors: [{ message: `XML Parsing Error: ${errorText}` }],
				warnings: [],
			};
		}
	} catch (e) {
		return {
			success: false,
			errors: [{ message: `XML Parsing Error: ${e instanceof Error ? e.message : String(e)}` }],
			warnings: [],
		};
	}

	// Validate root element is <fetch>
	const fetchElement = doc.documentElement;
	if (!fetchElement || fetchElement.nodeName.toLowerCase() !== "fetch") {
		return {
			success: false,
			errors: [
				{ message: `Root element must be <fetch>, found <${fetchElement?.nodeName || "none"}>` },
			],
			warnings: [],
		};
	}

	// Find the entity element (required)
	const entityElement = fetchElement.querySelector(":scope > entity");
	if (!entityElement) {
		return {
			success: false,
			errors: [{ message: "Missing required <entity> element inside <fetch>" }],
			warnings: [],
		};
	}

	// Validate entity has a name attribute
	const entityName = entityElement.getAttribute("name");
	if (!entityName) {
		return {
			success: false,
			errors: [{ message: "Entity element must have a 'name' attribute" }],
			warnings: [],
		};
	}

	try {
		// Parse the fetch options
		const options = parseFetchOptions(fetchElement, issues);

		// Parse the entity tree
		const entity = parseEntity(entityElement, issues);

		const fetchNode: FetchNode = {
			id: generateParseId(),
			type: "fetch",
			entity,
			options,
		};

		const errors: ParseError[] = issues
			.filter((i) => i.severity === "error")
			.map((i) => ({ message: i.message }));
		const warnings = issues.filter((i): i is ParseWarning => i.severity !== "error");

		return errors.length > 0
			? { success: false, errors, warnings }
			: { success: true, fetchNode, errors, warnings };
	} catch (e) {
		return {
			success: false,
			errors: [{ message: `Parsing Error: ${e instanceof Error ? e.message : String(e)}` }],
			warnings: issues.filter((i): i is ParseWarning => i.severity !== "error"),
		};
	}
}

/**
 * Parse fetch element attributes into options
 */
function parseFetchOptions(fetchElement: Element, issues: ParseIssue[]): FetchNode["options"] {
	const options: FetchNode["options"] = {};

	// Boolean options
	if (fetchElement.getAttribute("aggregate") === "true") {
		options.aggregate = true;
	}
	if (fetchElement.getAttribute("distinct") === "true") {
		options.distinct = true;
	}
	if (fetchElement.getAttribute("returntotalrecordcount") === "true") {
		options.returnTotalRecordCount = true;
	}
	if (fetchElement.getAttribute("no-lock") === "true") {
		options.noLock = true;
	}
	if (fetchElement.getAttribute("latematerialize") === "true") {
		options.latematerialize = true;
	}

	// Numeric options
	const top = fetchElement.getAttribute("top");
	if (top !== null) {
		const topNum = parseInt(top, 10);
		if (!isNaN(topNum)) {
			options.top = topNum;
		} else {
			issues.push({
				message: `Invalid 'top' value '${top}' (Dataverse rejects it); Parse to Tree drops it.`,
				element: "fetch",
				attribute: "top",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	const count = fetchElement.getAttribute("count");
	if (count !== null) {
		const countNum = parseInt(count, 10);
		if (!isNaN(countNum)) {
			options.count = countNum;
		} else {
			issues.push({
				message: `Invalid 'count' value '${count}' (Dataverse rejects it); Parse to Tree drops it.`,
				element: "fetch",
				attribute: "count",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	const page = fetchElement.getAttribute("page");
	if (page !== null) {
		const pageNum = parseInt(page, 10);
		if (!isNaN(pageNum)) {
			options.page = pageNum;
		} else {
			issues.push({
				message: `Invalid 'page' value '${page}' (Dataverse rejects it); Parse to Tree drops it.`,
				element: "fetch",
				attribute: "page",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	const utcOffset = fetchElement.getAttribute("utc-offset");
	if (utcOffset !== null) {
		const utcNum = parseInt(utcOffset, 10);
		if (!isNaN(utcNum)) {
			options.utcOffset = utcNum;
		} else {
			issues.push({
				message: `Invalid 'utc-offset' value '${utcOffset}'; Parse to Tree drops it.`,
				element: "fetch",
				attribute: "utc-offset",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	// String options
	const pagingCookie = fetchElement.getAttribute("paging-cookie");
	if (pagingCookie) {
		options.pagingCookie = pagingCookie;
	}

	// Attributes the tree won't keep (namespaces, unsupported, unknown)
	reportElementAttributes(fetchElement, "fetch", issues);

	return options;
}

/**
 * Parse entity element
 */
function parseEntity(entityElement: Element, issues: ParseIssue[]): EntityNode {
	const name = entityElement.getAttribute("name") || "";

	const entity: EntityNode = {
		id: generateParseId(),
		type: "entity",
		name,
		attributes: [],
		orders: [],
		filters: [],
		links: [],
	};

	// Parse optional entity attributes
	if (entityElement.getAttribute("enableprefiltering") === "true") {
		entity.enablePrefiltering = true;
	}
	const prefilterParam = entityElement.getAttribute("prefilterparametername");
	if (prefilterParam) {
		entity.prefilterParameterName = prefilterParam;
	}

	reportElementAttributes(entityElement, "entity", issues);

	// Parse child elements
	for (const child of entityElement.children) {
		const tagName = child.nodeName.toLowerCase();

		switch (tagName) {
			case "all-attributes":
				entity.allAttributes = parseAllAttributes(child, issues);
				break;
			case "attribute":
				entity.attributes.push(parseAttribute(child, issues));
				break;
			case "order":
				{
					const order = parseOrder(child, issues);
					if (order) entity.orders.push(order);
				}
				break;
			case "filter":
				entity.filters.push(parseFilter(child, issues));
				break;
			case "link-entity":
				entity.links.push(parseLinkEntity(child, issues));
				break;
			default:
				reportUnknownChild(child, "entity", issues);
		}
	}

	return entity;
}

/**
 * Parse all-attributes element
 * Note: Parameters reserved for future use (potential warnings for deprecated usage)
 */
function parseAllAttributes(_element: Element, _issues: ParseIssue[]): AllAttributesNode {
	return {
		id: generateParseId(),
		type: "all-attributes",
		enabled: true,
	};
}

/**
 * Parse attribute element
 */
function parseAttribute(attrElement: Element, issues: ParseIssue[]): AttributeNode {
	const name = attrElement.getAttribute("name") || "";

	if (!name) {
		issues.push({
			message: "Attribute element missing 'name' (Dataverse rejects it).",
			element: "attribute",
			severity: "warning",
			kind: "invalid",
		});
	}

	reportElementAttributes(attrElement, "attribute", issues);

	const attr: AttributeNode = {
		id: generateParseId(),
		type: "attribute",
		name,
	};

	// Optional attributes
	const alias = attrElement.getAttribute("alias");
	if (alias) {
		if (!isValidAlias(alias)) {
			const sanitized = sanitizeAlias(alias);
			issues.push({
				message: sanitized
					? `Alias '${alias}' has invalid characters; Parse to Tree changes it to '${sanitized}'.`
					: `Alias '${alias}' has no valid characters; Parse to Tree removes it.`,
				element: "attribute",
				attribute: "alias",
				severity: "warning",
				kind: "corrected",
			});
			if (sanitized) attr.alias = sanitized;
		} else {
			attr.alias = alias;
		}
	}

	if (attrElement.getAttribute("groupby") === "true") {
		attr.groupby = true;
	}

	const aggregate = attrElement.getAttribute("aggregate");
	if (aggregate) {
		const validAggregates = ["sum", "count", "countcolumn", "min", "max", "avg", "rowaggregate"];
		if (validAggregates.includes(aggregate)) {
			attr.aggregate = aggregate as AttributeNode["aggregate"];
		} else {
			issues.push({
				message: `Invalid aggregate value '${aggregate}'; Parse to Tree drops it.`,
				element: "attribute",
				attribute: "aggregate",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	const dategrouping = attrElement.getAttribute("dategrouping");
	if (dategrouping) {
		const validDateGroupings = [
			"day",
			"week",
			"month",
			"quarter",
			"year",
			"fiscal-period",
			"fiscal-year",
		];
		if (validDateGroupings.includes(dategrouping)) {
			attr.dategrouping = dategrouping as AttributeNode["dategrouping"];
		} else {
			issues.push({
				message: `Invalid dategrouping value '${dategrouping}'; Parse to Tree drops it.`,
				element: "attribute",
				attribute: "dategrouping",
				severity: "warning",
				kind: "dropped",
			});
		}
	}

	if (attrElement.hasAttribute("usertimezone")) {
		attr.usertimezone = attrElement.getAttribute("usertimezone") === "true";
	}

	return attr;
}

/**
 * Parse order element
 */
function parseOrder(orderElement: Element, issues: ParseIssue[]): OrderNode | null {
	const attribute = orderElement.getAttribute("attribute") || "";

	if (!attribute) {
		const alias = orderElement.getAttribute("alias");
		issues.push(
			alias
				? {
						message: `Order by alias '${alias}' is supported by Dataverse but not by the tree yet; Parse to Tree drops this order.`,
						element: "order",
						attribute: "alias",
						severity: "info",
						kind: "dropped",
					}
				: {
						message: "Order element has neither 'attribute' nor 'alias' (Dataverse rejects it); Parse to Tree drops it.",
						element: "order",
						severity: "warning",
						kind: "dropped",
					},
		);
		return null;
	}

	reportElementAttributes(orderElement, "order", issues);

	const order: OrderNode = {
		id: generateParseId(),
		type: "order",
		attribute,
	};

	if (orderElement.getAttribute("descending") === "true") {
		order.descending = true;
	}

	const entityname = orderElement.getAttribute("entityname");
	if (entityname) {
		order.entityname = entityname;
	}

	return order;
}

/**
 * Parse filter element (recursive for subfilters)
 */
function parseFilter(filterElement: Element, issues: ParseIssue[]): FilterNode {
	const type = filterElement.getAttribute("type") || "and";
	if (type !== "and" && type !== "or") {
		issues.push({
			message: `Invalid filter type '${type}'; Parse to Tree uses 'and'.`,
			element: "filter",
			attribute: "type",
			severity: "warning",
			kind: "corrected",
		});
	}
	reportElementAttributes(filterElement, "filter", issues);

	const filter: FilterNode = {
		id: generateParseId(),
		type: "filter",
		conjunction: type === "or" ? "or" : "and",
		conditions: [],
		subfilters: [],
		links: [],
	};

	const hint = filterElement.getAttribute("hint");
	if (hint === "union") {
		filter.hint = "union";
	}

	// Parse child elements
	for (const child of filterElement.children) {
		const tagName = child.nodeName.toLowerCase();

		switch (tagName) {
			case "condition":
				filter.conditions.push(parseCondition(child, issues));
				break;
			case "filter":
				filter.subfilters.push(parseFilter(child, issues));
				break;
			case "link-entity":
				// Parse link-entity inside filter (for any/not any/all/not all)
				filter.links.push(parseLinkEntity(child, issues));
				break;
			default:
				reportUnknownChild(child, "filter", issues);
		}
	}

	return filter;
}

/**
 * Parse condition element
 */
function parseCondition(condElement: Element, issues: ParseIssue[]): ConditionNode {
	const attribute = condElement.getAttribute("attribute") || "";
	const operatorAttr = condElement.getAttribute("operator");
	const operator = operatorAttr || "eq";

	if (!attribute) {
		issues.push({
			message: "Condition element missing 'attribute' (Dataverse rejects it).",
			element: "condition",
			severity: "warning",
			kind: "invalid",
		});
	}
	if (!operatorAttr) {
		issues.push({
			message: "Condition element missing 'operator'; Parse to Tree uses 'eq'.",
			element: "condition",
			attribute: "operator",
			severity: "warning",
			kind: "corrected",
		});
	} else if (!KNOWN_OPERATORS.has(operatorAttr)) {
		issues.push({
			message: `Unknown condition operator '${operatorAttr}' (Dataverse rejects it).`,
			element: "condition",
			attribute: "operator",
			severity: "warning",
			kind: "invalid",
		});
	}

	reportElementAttributes(condElement, "condition", issues);

	const condition: ConditionNode = {
		id: generateParseId(),
		type: "condition",
		attribute,
		operator: operator as OperatorType,
	};

	// Optional attributes
	const entityname = condElement.getAttribute("entityname");
	if (entityname) condition.entityname = entityname;

	const valueof = condElement.getAttribute("valueof");
	if (valueof) condition.valueof = valueof;

	const aggregate = condElement.getAttribute("aggregate");
	if (aggregate) {
		const validAggregates = ["sum", "count", "countcolumn", "min", "max", "avg"];
		if (validAggregates.includes(aggregate)) {
			condition.aggregate = aggregate as ConditionNode["aggregate"];
		}
	}

	// Parse value - can be from attribute or child <value> elements
	const valueAttr = condElement.getAttribute("value");
	const valueElements = condElement.querySelectorAll(":scope > value");

	if (valueElements.length > 0) {
		// Multiple value elements (for in, not-in, between, etc.)
		const values: (string | number)[] = [];
		for (const valEl of valueElements) {
			const valText = valEl.textContent?.trim() || "";
			// Try to parse as number if it looks like one
			const numVal = parseFloat(valText);
			if (!isNaN(numVal) && valText === numVal.toString()) {
				values.push(numVal);
			} else {
				values.push(valText);
			}
		}
		condition.value = values;
	} else if (valueAttr !== null) {
		// Single value attribute
		const numVal = parseFloat(valueAttr);
		if (!isNaN(numVal) && valueAttr === numVal.toString()) {
			condition.value = numVal;
		} else if (valueAttr === "true") {
			condition.value = true;
		} else if (valueAttr === "false") {
			condition.value = false;
		} else {
			condition.value = valueAttr;
		}
	}

	return condition;
}

/**
 * Parse link-entity element (recursive)
 */
function parseLinkEntity(linkElement: Element, issues: ParseIssue[]): LinkEntityNode {
	const name = linkElement.getAttribute("name") || "";
	const from = linkElement.getAttribute("from") || "";
	const to = linkElement.getAttribute("to") || "";

	if (!name) {
		issues.push({
			message: "Link-entity element missing 'name' (Dataverse rejects it).",
			element: "link-entity",
			severity: "warning",
			kind: "invalid",
		});
	}

	// Live-validated: from="" and to="" together return HTTP 200 with zero rows — silently wrong.
	const hasFrom = linkElement.hasAttribute("from");
	const hasTo = linkElement.hasAttribute("to");
	if (hasFrom && hasTo && !from && !to) {
		issues.push({
			message: `Link-entity '${name}' has empty 'from' and 'to' attributes; Dataverse returns no rows for this. Set both, or remove them for a system many-to-many relationship.`,
			element: "link-entity",
			severity: "error",
			kind: "invalid",
		});
	} else if (!from || !to) {
		const missing = [!from && "'from'", !to && "'to'"].filter(Boolean).join(" and ");
		issues.push({
			message: `Link-entity '${name}' is missing ${missing}. Dataverse can only infer the join for a system many-to-many relationship.`,
			element: "link-entity",
			severity: "warning",
			kind: "invalid",
		});
	}

	const linkTypeAttr = linkElement.getAttribute("link-type") || "inner";
	const validLinkTypes: LinkType[] = [
		"inner",
		"outer",
		"any",
		"not any",
		"all",
		"not all",
		"exists",
		"in",
		"matchfirstrowusingcrossapply",
	];

	let linkType: LinkType = "inner";
	if (validLinkTypes.includes(linkTypeAttr as LinkType)) {
		linkType = linkTypeAttr as LinkType;
	} else {
		issues.push({
			message: `Invalid link-type '${linkTypeAttr}' (Dataverse rejects it); Parse to Tree uses 'inner'.`,
			element: "link-entity",
			attribute: "link-type",
			severity: "warning",
			kind: "corrected",
		});
	}

	const link: LinkEntityNode = {
		id: generateParseId(),
		type: "link-entity",
		name,
		from,
		to,
		linkType,
		attributes: [],
		orders: [],
		filters: [],
		links: [],
	};

	// Optional attributes
	const alias = linkElement.getAttribute("alias");
	if (alias) {
		if (!isValidAlias(alias)) {
			const sanitized = sanitizeAlias(alias);
			issues.push({
				message: sanitized
					? `Alias '${alias}' has invalid characters; Parse to Tree changes it to '${sanitized}'.`
					: `Alias '${alias}' has no valid characters; Parse to Tree removes it.`,
				element: "link-entity",
				attribute: "alias",
				severity: "info",
				kind: "corrected",
			});
			if (sanitized) link.alias = sanitized;
		} else {
			link.alias = alias;
		}
	}

	reportElementAttributes(linkElement, "link-entity", issues);

	if (linkElement.getAttribute("intersect") === "true") {
		link.intersect = true;
	}

	if (linkElement.hasAttribute("visible")) {
		link.visible = linkElement.getAttribute("visible") === "true";
	}

	// Parse child elements
	for (const child of linkElement.children) {
		const tagName = child.nodeName.toLowerCase();

		switch (tagName) {
			case "all-attributes":
				link.allAttributes = parseAllAttributes(child, issues);
				break;
			case "attribute":
				link.attributes.push(parseAttribute(child, issues));
				break;
			case "order":
				{
					const order = parseOrder(child, issues);
					if (order) link.orders.push(order);
				}
				break;
			case "filter":
				link.filters.push(parseFilter(child, issues));
				break;
			case "link-entity":
				link.links.push(parseLinkEntity(child, issues));
				break;
			default:
				reportUnknownChild(child, "link-entity", issues);
		}
	}

	return link;
}

/**
 * Validate a FetchXML string without fully parsing it
 * Quick syntax check
 */
export function validateFetchXmlSyntax(xmlString: string): { valid: boolean; error?: string } {
	if (!xmlString?.trim()) {
		return { valid: false, error: "FetchXML string is empty" };
	}

	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xmlString.trim(), "application/xml");
		const parserError = doc.querySelector("parsererror");
		if (parserError) {
			return { valid: false, error: parserError.textContent || "Invalid XML syntax" };
		}

		const fetchElement = doc.documentElement;
		if (!fetchElement || fetchElement.nodeName.toLowerCase() !== "fetch") {
			return { valid: false, error: "Root element must be <fetch>" };
		}

		const entityElement = fetchElement.querySelector(":scope > entity");
		if (!entityElement) {
			return { valid: false, error: "Missing required <entity> element" };
		}

		if (!entityElement.getAttribute("name")) {
			return { valid: false, error: "Entity element must have a 'name' attribute" };
		}

		return { valid: true };
	} catch (e) {
		return { valid: false, error: e instanceof Error ? e.message : String(e) };
	}
}
