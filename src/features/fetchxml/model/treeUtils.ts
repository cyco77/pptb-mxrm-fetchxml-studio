/**
 * Utility functions for traversing and querying FetchXML tree nodes
 */

import type { FetchNode, EntityNode, LinkEntityNode, NodeId, FilterNode } from "./nodes";

/**
 * Information about a link-entity that can be referenced in entityname attribute
 */
export interface LinkEntityReference {
	/** The alias if specified, otherwise the entity logical name */
	identifier: string;
	/** The entity logical name */
	entityName: string;
	/** The alias (if specified) */
	alias?: string;
	/** Display label for the UI (e.g., "contact_alias (contact)") */
	displayLabel: string;
	/** The node ID of the link-entity */
	nodeId: NodeId;
}

/**
 * Recursively collects all link-entity references from the FetchXML tree.
 * These can be used in the entityname attribute of conditions.
 *
 * @param node - The FetchNode to traverse
 * @returns Array of LinkEntityReference objects
 */
export function collectLinkEntityReferences(node: FetchNode | null): LinkEntityReference[] {
	if (!node?.entity) {
		return [];
	}

	const references: LinkEntityReference[] = [];

	function collectFromEntity(entity: EntityNode | LinkEntityNode): void {
		// For link-entities, add them as references
		if (entity.type === "link-entity") {
			const linkEntity = entity as LinkEntityNode;
			const identifier = linkEntity.alias || linkEntity.name;
			references.push({
				identifier,
				entityName: linkEntity.name,
				alias: linkEntity.alias,
				displayLabel: linkEntity.alias
					? `${linkEntity.alias} (${linkEntity.name})`
					: linkEntity.name,
				nodeId: linkEntity.id,
			});
		}

		// Recursively process nested link-entities
		if (entity.links) {
			for (const link of entity.links) {
				collectFromEntity(link);
			}
		}
	}

	// Start from root entity's links
	for (const link of node.entity.links) {
		collectFromEntity(link);
	}

	return references;
}

/**
 * Determines if a condition is within the root entity's filter tree.
 * Conditions in root entity filters can use entityname to reference link-entities.
 *
 * @param fetchNode - The FetchNode to search in
 * @param conditionId - The ID of the condition to find
 * @returns True if the condition is in the root entity's filter tree
 */
export function isConditionInRootEntityFilter(
	fetchNode: FetchNode | null,
	conditionId: NodeId
): boolean {
	if (!fetchNode?.entity) {
		return false;
	}

	// Check if condition exists in root entity's filters
	function checkInFilters(filters: FilterNode[]): boolean {
		for (const filter of filters) {
			// Check conditions in this filter
			for (const condition of filter.conditions) {
				if (condition.id === conditionId) {
					return true;
				}
			}
			// Recursively check subfilters
			if (checkInFilters(filter.subfilters)) {
				return true;
			}
		}
		return false;
	}

	return checkInFilters(fetchNode.entity.filters);
}

/**
 * Finds the parent entity or link-entity for a given node ID.
 *
 * @param fetchNode - The FetchNode to search in
 * @param nodeId - The ID of the node to find the parent for
 * @returns The entity/link-entity name or null if not found
 */
export function findParentEntityForNode(
	fetchNode: FetchNode | null,
	nodeId: NodeId
): string | null {
	if (!fetchNode?.entity) {
		return null;
	}

	function findInEntity(
		entity: EntityNode | LinkEntityNode,
		targetId: NodeId,
		parentName: string
	): string | null {
		// Check in attributes
		for (const attr of entity.attributes) {
			if (attr.id === targetId) return parentName;
		}

		// Check in orders
		if ("orders" in entity) {
			for (const order of entity.orders) {
				if (order.id === targetId) return parentName;
			}
		}

		// Check in filters and conditions
		for (const filter of entity.filters) {
			const result = findInFilter(filter, targetId, parentName);
			if (result) return result;
		}

		// Check in nested link-entities
		const currentName = entity.type === "link-entity" ? entity.alias || entity.name : entity.name;
		for (const link of entity.links) {
			if (link.id === targetId) return parentName;
			const result = findInEntity(link, targetId, currentName);
			if (result) return result;
		}

		return null;
	}

	function findInFilter(filter: FilterNode, targetId: NodeId, parentName: string): string | null {
		if (filter.id === targetId) return parentName;

		for (const condition of filter.conditions) {
			if (condition.id === targetId) return parentName;
		}

		for (const subfilter of filter.subfilters) {
			const result = findInFilter(subfilter, targetId, parentName);
			if (result) return result;
		}

		return null;
	}

	// Check if it's the fetch or entity node itself
	if (fetchNode.id === nodeId) return null;
	if (fetchNode.entity.id === nodeId) return fetchNode.entity.name;

	return findInEntity(fetchNode.entity, nodeId, fetchNode.entity.name);
}

/**
 * Entities referenced by a query, used to drive metadata loading.
 */
export interface QueryEntities {
	/** Logical name of the root <entity>, or null when there is no query. */
	rootEntityName: string | null;
	/** Unique entity logical names: the root first, then link-entities in document order. */
	entityNames: string[];
	/**
	 * Stable key for effect dependencies. Includes the root explicitly, so swapping which table
	 * is the root (with the same set of tables) still changes the key.
	 */
	key: string;
}

/**
 * Collect the root entity and all link-entity names (recursively) from a query.
 *
 * The root is always taken from `fetchQuery.entity.name`, never from the position in a sorted
 * list. The returned arrays are fresh copies, so callers may sort them without side effects (#54).
 */
export function getQueryEntities(fetchQuery: FetchNode | null): QueryEntities {
	const rootEntityName = fetchQuery?.entity?.name || null;
	if (!fetchQuery || !rootEntityName) {
		return { rootEntityName: null, entityNames: [], key: "" };
	}

	const names = new Set<string>([rootEntityName]);
	const collectFromLinks = (links: LinkEntityNode[] | undefined) => {
		links?.forEach((link) => {
			if (link.name) names.add(link.name);
			collectFromLinks(link.links);
		});
	};
	collectFromLinks(fetchQuery.entity.links);

	const entityNames = Array.from(names);
	const key = `${rootEntityName}|${[...entityNames].sort().join(",")}`;
	return { rootEntityName, entityNames, key };
}
