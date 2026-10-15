/**
 * Many-to-many join construction (#85). Relationship metadata as returned by the sandbox; the
 * resulting joins were executed live and matched the intersect entity's rows.
 */
import { describe, expect, it } from "vitest";
import { planManyToManyJoin, type ManyToManyRelationship } from "./manyToMany";

const PK: Record<string, string> = { systemuser: "systemuserid", team: "teamid", connectionrole: "connectionroleid", appmodule: "appmoduleid", role: "roleid" };
const pk = (e: string) => PK[e];

const teammembership: ManyToManyRelationship = {
	Entity1LogicalName: "team",
	Entity2LogicalName: "systemuser",
	Entity1IntersectAttribute: "teamid",
	Entity2IntersectAttribute: "systemuserid",
	IntersectEntityName: "teammembership",
};

describe("planManyToManyJoin", () => {
	it("matches the documented systemuser → team example", () => {
		expect(planManyToManyJoin("systemuser", "systemuserid", teammembership, pk)).toEqual({
			intersect: { name: "teammembership", from: "systemuserid", to: "systemuserid" },
			target: { name: "team", from: "teamid", to: "teamid" },
		});
	});

	it("works from the other side (team → systemuser)", () => {
		expect(planManyToManyJoin("team", "teamid", teammembership, pk)).toEqual({
			intersect: { name: "teammembership", from: "teamid", to: "teamid" },
			target: { name: "systemuser", from: "systemuserid", to: "systemuserid" },
		});
	});

	it("self-referential: Entity1 side to Entity2 side, using the two different intersect attributes", () => {
		const rel: ManyToManyRelationship = {
			Entity1LogicalName: "connectionrole",
			Entity2LogicalName: "connectionrole",
			Entity1IntersectAttribute: "connectionroleid",
			Entity2IntersectAttribute: "associatedconnectionroleid",
			IntersectEntityName: "connectionroleassociation",
		};
		expect(planManyToManyJoin("connectionrole", "connectionroleid", rel, pk)).toEqual({
			intersect: { name: "connectionroleassociation", from: "connectionroleid", to: "connectionroleid" },
			target: { name: "connectionrole", from: "connectionroleid", to: "associatedconnectionroleid" },
		});
	});

	it("uses the intersect attributes from metadata, not the related entity's key names", () => {
		const rel: ManyToManyRelationship = {
			Entity1LogicalName: "appmodule",
			Entity2LogicalName: "role",
			Entity1IntersectAttribute: "appmoduleid",
			Entity2IntersectAttribute: "roleid",
			IntersectEntityName: "appmoduleroles",
		};
		expect(planManyToManyJoin("role", "roleid", rel, pk)?.intersect).toEqual({ name: "appmoduleroles", from: "roleid", to: "roleid" });
		expect(planManyToManyJoin("role", "roleid", rel, pk)?.target).toEqual({ name: "appmodule", from: "appmoduleid", to: "appmoduleid" });
	});

	it("returns undefined when the parent isn't part of the relationship", () => {
		expect(planManyToManyJoin("account", "accountid", teammembership, pk)).toBeUndefined();
	});
});
