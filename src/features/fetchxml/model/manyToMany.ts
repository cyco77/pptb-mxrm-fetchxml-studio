/**
 * Many-to-many joins (#85). A many-to-many relationship joins through its intersect entity with two
 * nested link-entities, as the docs show:
 * https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/join-tables#many-to-many-relationships
 *
 *   <entity name="systemuser">
 *     <link-entity name="teammembership" from="systemuserid" to="systemuserid" intersect="true">
 *       <link-entity name="team" from="teamid" to="teamid" alias="team" />
 *     </link-entity>
 *   </entity>
 *
 * Verified live (2026-10-15) on every many-to-many relationship with data in the sandbox, from both
 * sides (system, custom and self-referential): the join returns exactly the intersect entity's pairs.
 */

/** ManyToManyRelationshipMetadata fields the join needs */
export interface ManyToManyRelationship {
	Entity1LogicalName: string;
	Entity2LogicalName: string;
	Entity1IntersectAttribute: string;
	Entity2IntersectAttribute: string;
	IntersectEntityName: string;
}

export interface ManyToManyJoin {
	/** Outer link-entity: the intersect entity (intersect="true") */
	intersect: { name: string; from: string; to: string };
	/** Nested link-entity: the related entity */
	target: { name: string; from: string; to: string };
}

/**
 * The two link-entities that join `parentEntity` to the other side of `relationship`.
 * - intersect: from = the intersect entity's attribute for the parent's side, to = the parent's key;
 * - target: from = the related entity's key, to = the intersect entity's attribute for its side.
 * A self-referential relationship (Entity1 = Entity2) goes from the Entity1 side to the Entity2 side.
 */
export function planManyToManyJoin(
	parentEntity: string,
	parentPrimaryKey: string,
	relationship: ManyToManyRelationship,
	targetPrimaryKey: (targetEntity: string) => string,
): ManyToManyJoin | undefined {
	const fromEntity1 = relationship.Entity1LogicalName === parentEntity;
	if (!fromEntity1 && relationship.Entity2LogicalName !== parentEntity) return undefined;
	const parentAttribute = fromEntity1 ? relationship.Entity1IntersectAttribute : relationship.Entity2IntersectAttribute;
	const target = fromEntity1 ? relationship.Entity2LogicalName : relationship.Entity1LogicalName;
	const targetAttribute = fromEntity1 ? relationship.Entity2IntersectAttribute : relationship.Entity1IntersectAttribute;
	return {
		intersect: { name: relationship.IntersectEntityName, from: parentAttribute, to: parentPrimaryKey },
		target: { name: target, from: targetPrimaryKey(target), to: targetAttribute },
	};
}
