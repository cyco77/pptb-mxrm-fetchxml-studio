/**
 * PPTB host API adapter (#70): one place for feature detection and fallbacks, so FetchXML Studio
 * degrades gracefully on hosts that don't expose a newer API.
 *
 * Source for every API here: the @pptb/types 1.2.7 typings (toolboxAPI.d.ts, dataverseAPI.d.ts)
 * and README. https://docs.powerplatformtoolbox.com/tool-development/api-reference/toolbox-api
 */

import { connectionKey } from "../../../shared/hooks/connectionIdentity";

type ToolboxAPI = Window["toolboxAPI"];
export type Connection = NonNullable<Awaited<ReturnType<ToolboxAPI["connections"]["getActiveConnection"]>>>;

/** window.toolboxAPI, or undefined outside the ToolBox (dev server, tests) */
const toolbox = (): Partial<ToolboxAPI> | undefined =>
	typeof window === "undefined" ? undefined : (window.toolboxAPI as Partial<ToolboxAPI> | undefined);

/**
 * The tool's primary connection (slot 0). PPTB ≥ 1.2.7: connections.getConnection(0), the
 * slot-aware API; older hosts: getActiveConnection(). Null when the tool has no connection.
 */
export async function getPrimaryConnection(): Promise<Connection | null> {
	const connections = toolbox()?.connections;
	if (!connections) return null;
	if (typeof connections.getConnection === "function") return (await connections.getConnection(0)) ?? null;
	if (typeof connections.getActiveConnection === "function") return (await connections.getActiveConnection()) ?? null;
	return null;
}

/**
 * For multi-request write operations (#66): the returned check says whether the tool is still on
 * the connection it started on. Since PPTB 1.2.7 the connection can change in place, and every
 * later request goes to the new environment, where the same record IDs can exist (copied
 * environments). No guard (always true) when the connection can't be read at the start; a check
 * that can't read it says no.
 */
export async function connectionGuard(): Promise<() => Promise<boolean>> {
	let start: string;
	try {
		start = connectionKey(await getPrimaryConnection());
	} catch {
		return async () => true;
	}
	return async () => {
		try {
			return connectionKey(await getPrimaryConnection()) === start;
		} catch {
			return false;
		}
	};
}

/** Whether the host exposes dataverseAPI.executeBatch (PPTB ≥ 1.2.7) */
export function canExecuteBatch(): boolean {
	return typeof window !== "undefined" && typeof window.dataverseAPI?.executeBatch === "function";
}
