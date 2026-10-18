/**
 * Record delete through the host's dataverseAPI.executeBatch (PPTB ≥ 1.2.7) with the metadata
 * EntitySetName (#61). dataverseAPI.delete(entityLogicalName, id) builds the URL with the host's
 * English pluralizer, which is wrong for ~10% of custom tables (verified live, #61); executeBatch
 * takes explicit relative URLs.
 *
 * Microsoft Learn, Execute batch operations using the Web API:
 * https://learn.microsoft.com/power-apps/developer/data-platform/webapi/execute-batch-operations-using-web-api
 * - "Batch requests can contain up to 1,000 individual requests."
 * - Without `Prefer: odata.continue-on-error`, the batch stops at the first failing request. We
 *   don't send that header: any additional header makes PPTB ask the user for consent first.
 *
 * Host behaviour (PPTB 1.2.7 dataverseBatch.ts): executeBatch returns one result per operation,
 * but rejects when a batch stopped early (fewer results than operations). A one-operation batch
 * always returns its result. So a chunk that rejects is redone one record per batch: records the
 * stopped batch already deleted then answer 404 "Does Not Exist", which counts as deleted.
 */

import type { BatchDeleteProgress, BatchDeleteResult } from "./pptbClient";

type HostExecuteBatch = Window["dataverseAPI"]["executeBatch"];
export type BatchRequest = Parameters<HostExecuteBatch>[0][number];
export type BatchResult = Awaited<ReturnType<HostExecuteBatch>>[number];
export type ExecuteBatch = (requests: BatchRequest[]) => Promise<BatchResult[]>;

/** Records per $batch. Small enough for steady progress and short requests; Learn allows 1,000. */
export const DELETE_BATCH_SIZE = 25;

/** Service protection errors (429): number of requests, execution time, concurrent requests */
const THROTTLE_PATTERN = /\b429\b|0x80072322|0x80072321|0x80072326/i;
/** Waits before retrying a throttled batch. The host doesn't pass on Retry-After from a rejected batch. */
const THROTTLE_WAITS_MS = [5_000, 15_000, 30_000];

/** `${EntitySetName}(${id})`, the Web API URL of a record (relative, as executeBatch requires) */
export const recordUrl = (entitySetName: string, recordId: string) => `${entitySetName}(${recordId.replace(/[{}]/g, "")})`;

/** The Dataverse error code and message of a failed batch operation */
export function batchResultError(result: BatchResult): { code?: string; message: string } {
	const body = result.body as { error?: { code?: string; message?: string } } | string | undefined;
	if (body && typeof body === "object" && body.error) {
		return { code: body.error.code, message: body.error.message || `HTTP ${result.status}` };
	}
	const text = typeof body === "string" && body.trim() ? `: ${body.trim()}` : "";
	return { message: `HTTP ${result.status}${result.statusText ? ` ${result.statusText}` : ""}${text}` };
}

const isSuccess = (result: BatchResult) => result.status >= 200 && result.status < 300;

/**
 * The record doesn't exist (404, ObjectDoesNotExist 0x80040217). Not a 404 for an unknown entity
 * set segment (0x80060888): that one is a real failure.
 * @see https://learn.microsoft.com/power-apps/developer/data-platform/reference/web-service-error-codes
 */
export function isRecordNotFound(result: BatchResult): boolean {
	if (result.status !== 404) return false;
	const { code, message } = batchResultError(result);
	if (code?.toLowerCase() === "0x80040217") return true;
	return !/0x80060888|Resource not found for the segment/i.test(`${code} ${message}`) && /does not exist/i.test(message);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isThrottled = (error: unknown) => THROTTLE_PATTERN.test(errorMessage(error));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface BatchDeleteOptions {
	executeBatch: ExecuteBatch;
	onProgress?: (progress: BatchDeleteProgress) => void;
	batchSize?: number;
	/**
	 * Checked before every request; false stops the delete and reports the remaining records as
	 * not deleted (host.connectionGuard: the tool's connection changed, #66)
	 */
	shouldContinue?: () => boolean | Promise<boolean>;
	/** Injectable for tests */
	wait?: (ms: number) => Promise<void>;
}

/** Why records weren't deleted after shouldContinue said stop */
export const CONNECTION_CHANGED_MESSAGE = "Not deleted: the tool's connection changed during the delete";

/** Sends one batch, retrying while Dataverse throttles it */
async function sendWithRetry(requests: BatchRequest[], execute: ExecuteBatch, wait: (ms: number) => Promise<void>): Promise<BatchResult[]> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await execute(requests);
		} catch (error) {
			if (!isThrottled(error) || attempt >= THROTTLE_WAITS_MS.length) throw error;
			await wait(THROTTLE_WAITS_MS[attempt]);
		}
	}
}

/**
 * Deletes records in $batch requests of `batchSize`, reporting per-record errors and progress
 * (same shape as the parallel-request path it replaces).
 */
export async function deleteRecordsInBatches(
	entitySetName: string,
	recordIds: string[],
	{ executeBatch, onProgress, batchSize = DELETE_BATCH_SIZE, shouldContinue = () => true, wait = sleep }: BatchDeleteOptions,
): Promise<BatchDeleteResult> {
	const result: BatchDeleteResult = { succeeded: 0, failed: 0, errors: [] };
	const size = Math.max(1, Math.min(batchSize, 1000));
	const chunks: string[][] = [];
	for (let i = 0; i < recordIds.length; i += size) chunks.push(recordIds.slice(i, i + size));

	const record = (recordId: string, outcome: BatchResult | Error, retried: boolean) => {
		if (outcome instanceof Error) {
			result.failed++;
			result.errors.push(`${recordId}: ${outcome.message}`);
		} else if (isSuccess(outcome) || (retried && isRecordNotFound(outcome))) {
			result.succeeded++;
		} else {
			result.failed++;
			result.errors.push(`${recordId}: ${batchResultError(outcome).message}`);
		}
	};

	const chunkTimes: number[] = [];
	let completed = 0;
	let stopped = false;
	const stop = (ids: string[]) => ids.forEach((id) => record(id, new Error(CONNECTION_CHANGED_MESSAGE), false));
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index];
		const started = Date.now();
		const requests = chunk.map((id): BatchRequest => ({ method: "DELETE", url: recordUrl(entitySetName, id) }));

		let results: BatchResult[] | undefined;
		let failedEarly = false;
		if (stopped || !(await shouldContinue())) {
			stopped = true;
			stop(chunk);
		} else {
			try {
				results = await sendWithRetry(requests, executeBatch, wait);
			} catch (error) {
				// One record per batch tells which records failed (see the file comment). A lone
				// record gets the error itself: there's nothing to tell apart.
				if (chunk.length === 1) {
					record(chunk[0], new Error(errorMessage(error)), false);
				} else {
					failedEarly = true;
					console.warn(`Delete batch ${index + 1} stopped early, retrying its records one by one:`, error);
				}
			}
		}

		if (results && results.length === chunk.length) {
			chunk.forEach((id, i) => record(id, results![i], false));
		} else if (failedEarly || results) {
			for (const [i, id] of chunk.entries()) {
				if (!(await shouldContinue())) {
					stopped = true;
					stop(chunk.slice(i));
					break;
				}
				try {
					const [single] = await sendWithRetry([{ method: "DELETE", url: recordUrl(entitySetName, id) }], executeBatch, wait);
					record(id, single ?? new Error("No response for this record"), true);
				} catch (error) {
					record(id, new Error(errorMessage(error)), true);
				}
			}
		}

		completed += chunk.length;
		chunkTimes.push(Date.now() - started);
		const remaining = chunks.length - (index + 1);
		const average = chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length;
		onProgress?.({
			completed,
			total: recordIds.length,
			succeeded: result.succeeded,
			failed: result.failed,
			batchesCompleted: index + 1,
			totalBatches: chunks.length,
			estimatedSecondsRemaining: chunkTimes.length >= 2 ? Math.ceil((average * remaining) / 1000) : undefined,
		});
	}
	return result;
}
