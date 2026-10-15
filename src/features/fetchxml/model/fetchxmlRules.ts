/**
 * Query-level FetchXML rules that need the whole tree (#90b). Shared by the parser (Validate,
 * Execute, Parse to Tree) and the property editors, so both report the same thing.
 *
 * Principle (#89): what the FetchXML reference documents is supported, plus what is verified to
 * work; only what Dataverse is known to reject is an error. Every rule below was executed against a
 * live Dataverse org through the PPTB request path; the error code Dataverse returns is quoted in
 * each message. Rules that need attribute metadata live in attributeCapabilities.ts.
 */

import type {
	AttributeNode,
	EntityNode,
	FetchNode,
	FilterNode,
	LinkEntityNode,
	OrderNode,
} from "./nodes";

export type RuleSeverity = "error" | "warning" | "info";
export type RuleKind = "invalid" | "ignored" | "advice";

export interface RuleFinding {
	message: string;
	element: string;
	attribute?: string;
	severity: RuleSeverity;
	kind: RuleKind;
	/** Tree node the finding is about, so editors can show it on that node */
	nodeId: string;
}

type Container = EntityNode | LinkEntityNode;

interface Scope {
	container: Container;
	isRoot: boolean;
	/** Nesting level of filters, starting at 1 for a container's own filter */
	filters: { filter: FilterNode; depth: number }[];
}

/** Every entity / link-entity in the query, including link-entities inside filters. */
function collectScopes(fetch: FetchNode): Scope[] {
	const scopes: Scope[] = [];
	const visit = (container: Container, isRoot: boolean) => {
		const scope: Scope = { container, isRoot, filters: [] };
		scopes.push(scope);
		const visitFilter = (filter: FilterNode, depth: number) => {
			scope.filters.push({ filter, depth });
			filter.subfilters.forEach((f) => visitFilter(f, depth + 1));
			filter.links?.forEach((l) => visit(l, false));
		};
		container.filters.forEach((f) => visitFilter(f, 1));
		container.links.forEach((l) => visit(l, false));
	};
	visit(fetch.entity, true);
	return scopes;
}

const isLink = (c: Container): c is LinkEntityNode => c.type === "link-entity";

/**
 * Attributes an aggregate `<order alias>` can see. Dataverse resolves the alias only within the
 * order's own scope: the entity / link-entity the order is in, or, for an order in the root entity
 * with `entityname`, that link-entity (verified: other aliases fail with 0x8004110a).
 */
function orderAliasScope(order: OrderNode, scope: Scope, links: LinkEntityNode[]): AttributeNode[] {
	if (scope.isRoot && order.entityname) {
		const target =
			links.find((l) => l.alias === order.entityname) ?? links.find((l) => l.name === order.entityname);
		if (target) return target.attributes;
	}
	return scope.container.attributes;
}

export function validateQueryRules(fetch: FetchNode): RuleFinding[] {
	const findings: RuleFinding[] = [];
	const aggregate = fetch.options.aggregate === true;
	const scopes = collectScopes(fetch);
	const links = scopes.map((s) => s.container).filter(isLink);
	const push = (f: RuleFinding) => findings.push(f);

	// ---- attributes
	for (const scope of scopes) {
		for (const attr of scope.container.attributes) {
			const name = attr.name || "(unnamed)";
			const base = { element: "attribute", nodeId: attr.id } as const;

			if (attr.rowAggregate !== undefined) {
				if (aggregate) {
					// SQL error 4104 even with groupby; 0x8004111e without
					push({ ...base, attribute: "rowaggregate", severity: "error", kind: "invalid",
						message: `Count child records (rowaggregate) doesn't work in an aggregate query; Dataverse rejects '${name}'.` });
				} else if (!scope.isRoot) {
					push({ ...base, attribute: "rowaggregate", severity: "error", kind: "invalid",
						message: `Count child records (rowaggregate) only works on the root entity; inside a link-entity Dataverse fails with an internal error.` });
				} else if (!attr.alias) {
					push({ ...base, attribute: "rowaggregate", severity: "error", kind: "invalid",
						message: `Count child records (rowaggregate) on '${name}' needs an alias; without one Dataverse fails with a SQL error.` });
				}
			}

			if (aggregate) {
				if (attr.groupby && attr.aggregate) {
					push({ ...base, attribute: "groupby", severity: "error", kind: "invalid",
						message: `'${name}' can't be both Group by and an aggregate (Dataverse rejects it: 0x80041137).` });
				} else if (!attr.groupby && !attr.aggregate && attr.rowAggregate === undefined) {
					push({ ...base, severity: "error", kind: "invalid",
						message: `In an aggregate query every attribute needs Group by or an aggregate function; Dataverse rejects '${name}' (0x8004111e).` });
				}
				if (!attr.alias) {
					push({ ...base, attribute: "alias", severity: "error", kind: "invalid",
						message: `In an aggregate query every attribute needs an alias; '${name}' has none (Dataverse rejects it: 0x8004110b).` });
				}
				if (attr.dategrouping && attr.aggregate && !attr.groupby) {
					push({ ...base, attribute: "dategrouping", severity: "info", kind: "ignored",
						message: `Date grouping on '${name}' is ignored: it only applies to Group by.` });
				}
				if (attr.distinct && attr.aggregate !== "countcolumn") {
					push({ ...base, attribute: "distinct", severity: "info", kind: "advice",
						message: `'distinct' on '${name}' is only documented with the countcolumn aggregate.` });
				}
			} else {
				if (attr.aggregate) {
					push({ ...base, attribute: "aggregate", severity: "error", kind: "invalid",
						message: `'${name}' has aggregate="${attr.aggregate}", but the query isn't an aggregate query (Dataverse rejects it: 0x8004111a).` });
				}
				if (attr.groupby) {
					push({ ...base, attribute: "groupby", severity: "error", kind: "invalid",
						message: `'${name}' has Group by, but the query isn't an aggregate query (Dataverse rejects it: 0x8004112e).` });
				}
				const ignored = [
					attr.dategrouping && "dategrouping",
					attr.usertimezone !== undefined && "usertimezone",
					attr.distinct && "distinct",
				].filter((x): x is string => typeof x === "string");
				if (ignored.length > 0) {
					push({ ...base, attribute: ignored[0], severity: "info", kind: "ignored",
						message: `${ignored.map((a) => `'${a}'`).join(", ")} on '${name}' ${ignored.length > 1 ? "are" : "is"} ignored outside aggregate queries.` });
				}
			}
		}
	}

	// ---- aliases: unique across the whole query, case-insensitive (0x80041130). An alias also
	// clashes with the auto-generated name of an unaliased root attribute (its logical name).
	const rootNames = new Set(
		fetch.entity.attributes.filter((a) => !a.alias && a.name).map((a) => a.name.toLowerCase()),
	);
	const seenAliases = new Map<string, AttributeNode>();
	for (const scope of scopes) {
		for (const attr of scope.container.attributes) {
			if (!attr.alias) continue;
			const key = attr.alias.toLowerCase();
			if (seenAliases.has(key)) {
				push({ element: "attribute", attribute: "alias", nodeId: attr.id, severity: "error", kind: "invalid",
					message: `Alias '${attr.alias}' is used more than once (aliases are case-insensitive); Dataverse rejects it (0x80041130).` });
			} else if (rootNames.has(key) && !(scope.isRoot && attr.name.toLowerCase() === key)) {
				push({ element: "attribute", attribute: "alias", nodeId: attr.id, severity: "error", kind: "invalid",
					message: `Alias '${attr.alias}' clashes with the attribute '${key}' selected without an alias; Dataverse rejects it (0x80041130).` });
			}
			seenAliases.set(key, attr);
		}
	}
	const seenLinkAliases = new Set<string>();
	for (const link of links) {
		if (!link.alias) continue;
		if (seenLinkAliases.has(link.alias)) {
			push({ element: "link-entity", attribute: "alias", nodeId: link.id, severity: "error", kind: "invalid",
				message: `Link-entity alias '${link.alias}' is used more than once; Dataverse rejects it (0x80041130).` });
		}
		seenLinkAliases.add(link.alias);
	}

	// ---- orders
	const entityNames = new Set<string>([fetch.entity.name, ...links.flatMap((l) => [l.name, l.alias ?? ""])]);
	let anyOrder = false;
	for (const scope of scopes) {
		for (const order of scope.container.orders) {
			anyOrder = true;
			const base = { element: "order", nodeId: order.id } as const;
			if (aggregate && order.attribute) {
				push({ ...base, attribute: "attribute", severity: "error", kind: "invalid",
					message: `In an aggregate query, order by the attribute's alias instead of attribute '${order.attribute}' (Dataverse rejects it: 0x80041131).` });
			} else if (!aggregate && order.alias) {
				push({ ...base, attribute: "alias", severity: "error", kind: "invalid",
					message: `Ordering by alias '${order.alias}' only works in aggregate queries; use 'attribute' instead (Dataverse rejects it: 0x80041132).` });
			} else if (aggregate && order.alias) {
				const visible = orderAliasScope(order, scope, links);
				if (!visible.some((a) => a.alias === order.alias)) {
					const where = scope.isRoot && order.entityname ? `link-entity '${order.entityname}'` : isLink(scope.container) ? `link-entity '${scope.container.alias ?? scope.container.name}'` : "the root entity";
					push({ ...base, attribute: "alias", severity: "error", kind: "invalid",
						message: `Alias '${order.alias}' isn't defined on ${where}; an aggregate order can only use aliases from its own entity (Dataverse rejects it: 0x8004110a).` });
				}
			}
			if (order.entityname) {
				if (!scope.isRoot) {
					push({ ...base, attribute: "entityname", severity: "error", kind: "invalid",
						message: `'entityname' isn't allowed on an order inside a link-entity (Dataverse rejects it: 0x80041108). Move the order to the root entity.` });
				} else if (!entityNames.has(order.entityname)) {
					push({ ...base, attribute: "entityname", severity: "error", kind: "invalid",
						message: `No link-entity has the alias or name '${order.entityname}' (Dataverse rejects it: 0x80041108).` });
				}
			}
		}
	}

	// ---- fetch options
	if (fetch.options.aggregateLimit !== undefined) {
		if (!aggregate) {
			push({ element: "fetch", attribute: "aggregatelimit", nodeId: fetch.id, severity: "info", kind: "ignored",
				message: `'aggregatelimit' is ignored: the query isn't an aggregate query.` });
		} else if (anyOrder) {
			// Undocumented platform behaviour, reproduced on every table tried
			push({ element: "fetch", attribute: "aggregatelimit", nodeId: fetch.id, severity: "error", kind: "invalid",
				message: `Dataverse returns a SQL error when an aggregate query with 'aggregatelimit' also has an order. Remove the order or the limit.` });
		}
	}

	// ---- filters
	const unionFilters: { filter: FilterNode; depth: number }[] = [];
	for (const scope of scopes) {
		for (const { filter, depth } of scope.filters) {
			const base = { element: "filter", nodeId: filter.id } as const;
			if (filter.hint === "union") {
				unionFilters.push({ filter, depth });
				if (filter.conjunction !== "or") {
					push({ ...base, attribute: "hint", severity: "error", kind: "invalid",
						message: `The union hint only works on an 'or' filter (Dataverse rejects it: 0x80041122).` });
				} else if (depth > 3) {
					push({ ...base, attribute: "hint", severity: "info", kind: "ignored",
						message: `The union hint is more than three filter levels deep, so Dataverse ignores it.` });
				}
			}
			if (filter.overrideQuickFindRecordLimitEnabled && filter.overrideQuickFindRecordLimitDisabled) {
				push({ ...base, attribute: "overridequickfindrecordlimitenabled", severity: "info", kind: "advice",
					message: `Both quick find record limit overrides are set; which one applies isn't documented. Keep one.` });
			}
		}
	}
	for (const { filter } of unionFilters.slice(1)) {
		push({ element: "filter", attribute: "hint", nodeId: filter.id, severity: "error", kind: "invalid",
			message: `Only one filter per query can use the union hint (Dataverse rejects it: 0x80041122).` });
	}

	return findings;
}
