/**
 * What Dataverse lets you do with an attribute, by its metadata (#90b). The FetchXML reference
 * documents what each aggregate function returns, but not which attribute types accept it, so this
 * matrix is "known to work": every cell was executed against a live org (a 912-query matrix over
 * every AttributeTypeName, plus an org-wide scan for rare types), through both
 * dataverseAPI.fetchXmlQuery and queryData with the metadata EntitySetName, with identical results.
 *
 * Only attributes the pickers offer (IsValidForAdvancedFind) are in scope.
 */

import type { AttributeNode } from "./nodes";

export type AggregateFunction = NonNullable<AttributeNode["aggregate"]>;

export const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = ["count", "countcolumn", "sum", "avg", "min", "max"];

/** The metadata fields the rules need (AttributeMetadata subset). */
export interface AttributeTypeInfo {
	/** AttributeTypeName.Value, e.g. "MoneyType". Falls back to `${AttributeType}Type`. */
	typeName: string;
	/** IsLogical: true for composite Memo attributes such as address1_composite */
	isLogical?: boolean;
}

export interface AttributeCapabilities {
	order: boolean;
	groupby: boolean;
	/** Group by needs a date grouping (DateTime: 0x80041135 without one) */
	groupbyNeedsDateGrouping: boolean;
	functions: readonly AggregateFunction[];
	/** Why order / group by / aggregates aren't available, when they aren't */
	reason?: string;
}

const NUMERIC = new Set(["IntegerType", "BigIntType", "DecimalType", "DoubleType", "MoneyType"]);
const NOT_QUERYABLE = new Set(["ImageType", "FileType", "VirtualType"]);

export function toAttributeTypeInfo(metadata: {
	AttributeType?: string;
	AttributeTypeName?: { Value?: string };
	IsLogical?: boolean;
}): AttributeTypeInfo {
	return {
		typeName: metadata.AttributeTypeName?.Value ?? `${metadata.AttributeType ?? ""}Type`,
		isLogical: metadata.IsLogical,
	};
}

export function getAttributeCapabilities(type: AttributeTypeInfo): AttributeCapabilities {
	const t = type.typeName;
	if (t === "MultiSelectPicklistType") {
		// order / groupby: 0x80050224; count / countcolumn: 0x80060888; others: 0x8004112f
		return { order: false, groupby: false, groupbyNeedsDateGrouping: false, functions: [],
			reason: "Dataverse can't sort, group or aggregate multi-select option set attributes." };
	}
	if (NOT_QUERYABLE.has(t)) {
		return { order: false, groupby: false, groupbyNeedsDateGrouping: false, functions: [],
			reason: `Dataverse can't sort, group or aggregate ${t.replace(/Type$/, "")} attributes.` };
	}
	if (t === "MemoType" && type.isLogical) {
		// Composite attributes: groupby / count / countcolumn 0x8004111e; sort works
		return { order: true, groupby: false, groupbyNeedsDateGrouping: false, functions: [],
			reason: "Composite attributes (such as address1_composite) can't be grouped or aggregated." };
	}
	const functions: AggregateFunction[] = [];
	// Money counts fail in the Web API ("expected Money", 0x80060888) on both execution paths
	if (t !== "MoneyType") functions.push("count", "countcolumn");
	if (NUMERIC.has(t)) functions.push("sum", "avg"); // 0x8004112f otherwise
	if (NUMERIC.has(t) || t === "DateTimeType") functions.push("min", "max"); // 0x8004112f otherwise
	return { order: true, groupby: true, groupbyNeedsDateGrouping: t === "DateTimeType", functions };
}

/** Why an aggregate function isn't available for an attribute type (for editor messages). */
export function getUnsupportedFunctionReason(fn: AggregateFunction, type: AttributeTypeInfo): string | undefined {
	const caps = getAttributeCapabilities(type);
	if (caps.functions.includes(fn)) return undefined;
	if (caps.reason) return caps.reason;
	if ((fn === "count" || fn === "countcolumn") && type.typeName === "MoneyType") {
		return "Counts of Money attributes fail in the Dataverse Web API (0x80060888). Count another attribute, such as the primary key.";
	}
	if (fn === "sum" || fn === "avg") return "Sum and Average only work on number and Money attributes (Dataverse rejects it: 0x8004112f).";
	return "Minimum and Maximum only work on number, Money and DateTime attributes (Dataverse rejects it: 0x8004112f).";
}

/** Metadata-only checks for one attribute node in its query (rules R8c, R10, R15, R16). */
export function getAttributeMetadataIssues(
	attr: AttributeNode,
	type: AttributeTypeInfo | undefined,
	context: { aggregateQuery: boolean; primaryIdAttribute?: string; isHierarchical?: boolean },
): string[] {
	const issues: string[] = [];
	if (attr.rowAggregate !== undefined && !context.aggregateQuery) {
		if (context.isHierarchical === false) {
			issues.push("Count child records only works on entities with a hierarchical relationship (Dataverse rejects it: 0x80047020).");
		} else if (context.primaryIdAttribute && attr.name !== context.primaryIdAttribute) {
			issues.push(`Count child records only works on the primary key (${context.primaryIdAttribute}); Dataverse rejects it on other attributes (0x80040203).`);
		}
	}
	if (!type || !context.aggregateQuery) return issues; // metadata unknown: don't block
	const caps = getAttributeCapabilities(type);
	if (attr.aggregate && !caps.functions.includes(attr.aggregate)) {
		issues.push(getUnsupportedFunctionReason(attr.aggregate, type)!);
	}
	if (attr.groupby && !caps.groupby) {
		issues.push(caps.reason ?? "Dataverse can't group by this attribute.");
	}
	if (attr.groupby && caps.groupbyNeedsDateGrouping && !attr.dategrouping) {
		issues.push("Group by on a DateTime attribute needs a date grouping (Dataverse rejects it: 0x80041135).");
	}
	return issues;
}

/** Metadata check for an order on a (non-aggregate) attribute (rule R17). */
export function getOrderMetadataIssue(type: AttributeTypeInfo | undefined): string | undefined {
	if (!type) return undefined;
	const caps = getAttributeCapabilities(type);
	return caps.order ? undefined : caps.reason;
}

/** datasource="retained" needs long-term retention on the root entity (rule R18, 0x80097528). */
export function getDataSourceIssue(
	dataSource: string | undefined,
	entity: { logicalName: string; isRetentionEnabled?: boolean },
): string | undefined {
	if (dataSource !== "retained" || entity.isRetentionEnabled !== false) return undefined;
	return `Long-term retention isn't enabled for ${entity.logicalName} (IsRetentionEnabled is false), so Dataverse can't query its retained data.`;
}
