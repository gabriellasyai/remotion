import type {BrowserPoolManager} from './browser-pool';
import {AsyncQueue} from './job-queue';
import type {NvencGpuType} from './nvenc-detection';
import {NvencSessionManager, type NvencSessionLease} from './nvenc-session-manager';
import type {
	RenderMediaOptions,
	RenderMediaProgress,
	SlowFrame,
} from './render-media';
import {renderMedia} from './render-media';

export type RenderJobStatus = 'queued' | 'rendering' | 'done' | 'error';

export type RenderMediaResult = {
	buffer: Buffer | null;
	slowestFrames: SlowFrame[];
	contentType: string;
};

export type RenderJob = {
	id: string;
	status: RenderJobStatus;
	options: RenderMediaOptions;
	priority: number;
	result?: RenderMediaResult;
	error?: Error;
};

export type SchedulerConfig = {
	/** How many renderMedia() calls run simultaneously. Default: 4 */
	maxConcurrentJobs?: number;
	/** NVENC session limit. Default: based on nvencGpuType, or maxConcurrentJobs if no GPU type set */
	maxConcurrentEncodes?: number;
	/** Shared browser pool from Piece 2. When provided, each job uses it via browserPool option. */
	browserPool?: BrowserPoolManager;
	/** GPU type for NVENC session limiting. 'consumer' = 5 sessions, 'enterprise' = unlimited. */
	nvencGpuType?: NvencGpuType;
	/** Called when a job starts rendering */
	onJobStart?: (job: RenderJob) => void;
	/** Called on each renderMedia progress update */
	onJobProgress?: (job: RenderJob, progress: RenderMediaProgress) => void;
	/** Called when a job completes successfully */
	onJobComplete?: (job: RenderJob) => void;
	/** Called when a job fails */
	onJobError?: (job: RenderJob, error: Error) => void;
};

type ResolvedSchedulerConfig = {
	maxConcurrentJobs: number;
	maxConcurrentEncodes: number;
	browserPool: BrowserPoolManager | undefined;
	nvencGpuType: NvencGpuType | undefined;
	onJobStart: ((job: RenderJob) => void) | undefined;
	onJobProgress:
		| ((job: RenderJob, progress: RenderMediaProgress) => void)
		| undefined;
	onJobComplete: ((job: RenderJob) => void) | undefined;
	onJobError: ((job: RenderJob, error: Error) => void) | undefined;
};

type SchedulerStats = {
	queued: number;
	rendering: number;
	completed: number;
	failed: number;
	totalJobs: number;
};

const DEFAULT_MAX_CONCURRENT_JOBS = 4;

let jobCounter = 0;

const resolveConfig = (config: SchedulerConfig): ResolvedSchedulerConfig => {
	const maxConcurrentJobs =
		config.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;

	// If nvencGpuType is set, use the NVENC session limit as maxConcurrentEncodes default.
	// Otherwise, no encode-level limiting beyond the job-level limit.
	let maxConcurrentEncodes: number;
	if (config.maxConcurrentEncodes !== undefined) {
		maxConcurrentEncodes = config.maxConcurrentEncodes;
	} else if (config.nvencGpuType) {
		// Let NvencSessionManager handle the default from nvenc-detection
		maxConcurrentEncodes = -1; // sentinel: use NvencSessionManager's built-in limit
	} else {
		maxConcurrentEncodes = maxConcurrentJobs;
	}

	return {
		maxConcurrentJobs,
		maxConcurrentEncodes,
		browserPool: config.browserPool,
		nvencGpuType: config.nvencGpuType,
		onJobStart: config.onJobStart,
		onJobProgress: config.onJobProgress,
		onJobComplete: config.onJobComplete,
		onJobError: config.onJobError,
	};
};

/**
 * Orchestrates multiple concurrent renderMedia() calls with:
 * - Concurrency-limited job queue with priority ordering
 * - NVENC session management (consumer GPUs limited to 5 concurrent encodes)
 * - Shared browser pool integration
 * - Automatic pipe mode (forceParallelEncoding) for throughput
 *
 * Usage:
 * ```ts
 * const scheduler = new JobScheduler({
 *   maxConcurrentJobs: 10,
 *   nvencGpuType: 'consumer',
 *   browserPool: myPool,
 * });
 *
 * const result = await scheduler.addJob({
 *   serveUrl: 'https://...',
 *   codec: 'h264',
 *   composition: myComp,
 * });
 *
 * await scheduler.shutdown();
 * ```
 */
export class JobScheduler {
	#config: ResolvedSchedulerConfig;
	#queue: AsyncQueue<RenderJob>;
	#nvencManager: NvencSessionManager | null;
	#jobs: Map<string, RenderJob> = new Map();
	#completedCount = 0;
	#failedCount = 0;
	#shutdownRequested = false;
	#allDoneResolvers: Array<() => void> = [];

	constructor(config: SchedulerConfig) {
		this.#config = resolveConfig(config);

		// The effective concurrency is min(maxConcurrentJobs, maxConcurrentEncodes)
		// when using NVENC, because we acquire an NVENC session before starting
		// the render. However, we let the queue run at maxConcurrentJobs and use
		// the NvencSessionManager as a secondary gate inside the processor.
		this.#queue = new AsyncQueue<RenderJob>(this.#config.maxConcurrentJobs);

		// Set up NVENC session manager if a GPU type is configured
		if (this.#config.nvencGpuType) {
			this.#nvencManager = new NvencSessionManager(
				this.#config.nvencGpuType,
			);
		} else {
			this.#nvencManager = null;
		}
	}

	/**
	 * Add a render job to the queue. Returns when the job completes.
	 * Jobs with lower priority numbers are processed first.
	 */
	async addJob(
		options: RenderMediaOptions,
		priority = 0,
	): Promise<RenderMediaResult> {
		if (this.#shutdownRequested) {
			throw new Error(
				'[JobScheduler] Scheduler is shutting down, cannot add new jobs',
			);
		}

		const job = this.#createJob(options, priority);
		this.#jobs.set(job.id, job);

		await this.#queue.enqueue(
			job,
			(j) => this.#processJob(j),
			priority,
		);

		if (job.error) {
			throw job.error;
		}

		return job.result!;
	}

	/**
	 * Add multiple jobs. Returns when ALL complete.
	 * Failed jobs throw an AggregateError if any fail.
	 */
	async addBatch(
		jobs: Array<{options: RenderMediaOptions; priority?: number}>,
	): Promise<RenderMediaResult[]> {
		if (this.#shutdownRequested) {
			throw new Error(
				'[JobScheduler] Scheduler is shutting down, cannot add new jobs',
			);
		}

		const results: Array<{
			index: number;
			result?: RenderMediaResult;
			error?: Error;
		}> = [];

		const promises = jobs.map((jobSpec, index) => {
			return this.addJob(jobSpec.options, jobSpec.priority ?? 0)
				.then((result) => {
					results.push({index, result});
				})
				.catch((err: Error) => {
					results.push({index, error: err});
				});
		});

		await Promise.all(promises);

		// Sort back to original order
		results.sort((a, b) => a.index - b.index);

		const errors = results.filter((r) => r.error);
		if (errors.length > 0) {
			const errMsg = `[JobScheduler] ${errors.length} of ${jobs.length} jobs failed`;
			const aggregateError = new Error(errMsg) as Error & {
				errors: Error[];
			};
			aggregateError.errors = errors.map((e) => e.error!);
			throw aggregateError;
		}

		return results.map((r) => r.result!);
	}

	/**
	 * Get current scheduler statistics.
	 */
	getStats(): SchedulerStats {
		let queued = 0;
		let rendering = 0;

		for (const job of this.#jobs.values()) {
			if (job.status === 'queued') {
				queued++;
			} else if (job.status === 'rendering') {
				rendering++;
			}
		}

		return {
			queued,
			rendering,
			completed: this.#completedCount,
			failed: this.#failedCount,
			totalJobs: this.#jobs.size,
		};
	}

	/**
	 * Wait for all queued and in-progress jobs to complete.
	 */
	async waitForAll(): Promise<void> {
		if (this.#queue.active === 0 && this.#queue.pending === 0) {
			return;
		}

		return new Promise<void>((resolve) => {
			this.#allDoneResolvers.push(resolve);
		});
	}

	/**
	 * Cancel all pending jobs. In-progress jobs continue to completion.
	 */
	cancelPending(): void {
		this.#queue.cancelPending('[JobScheduler] Job cancelled');

		// Mark cancelled jobs
		for (const job of this.#jobs.values()) {
			if (job.status === 'queued') {
				job.status = 'error';
				job.error = new Error('[JobScheduler] Job cancelled');
				this.#failedCount++;
			}
		}
	}

	/**
	 * Graceful shutdown: cancel pending jobs, wait for in-progress jobs,
	 * then close the NVENC session manager.
	 */
	async shutdown(): Promise<void> {
		this.#shutdownRequested = true;
		this.cancelPending();

		// Wait for in-progress jobs to finish
		if (this.#queue.active > 0) {
			await this.waitForAll();
		}

		// Close NVENC session manager
		if (this.#nvencManager) {
			this.#nvencManager.close();
		}
	}

	#createJob(options: RenderMediaOptions, priority: number): RenderJob {
		jobCounter++;
		return {
			id: `job-${jobCounter}`,
			status: 'queued',
			options,
			priority,
		};
	}

	async #processJob(job: RenderJob): Promise<void> {
		let nvencLease: NvencSessionLease | null = null;

		try {
			// Acquire NVENC session if manager is present
			if (this.#nvencManager) {
				nvencLease = await this.#nvencManager.acquire();
			}

			job.status = 'rendering';
			this.#config.onJobStart?.(job);

			// Build the options for renderMedia, layering in scheduler defaults
			const renderOptions: RenderMediaOptions = {
				...job.options,
				// Use the shared browser pool if provided
				...(this.#config.browserPool
					? {browserPool: this.#config.browserPool}
					: {}),
				// Use hardware acceleration when NVENC sessions are managed
				...(this.#nvencManager
					? {hardwareAcceleration: 'if-possible' as const}
					: {}),
				// Force pipe mode for throughput
				forceParallelEncoding: true,
				// Wire up progress reporting
				onProgress: (progress: RenderMediaProgress) => {
					job.options.onProgress?.(progress);
					this.#config.onJobProgress?.(job, progress);
				},
			};

			const result = await renderMedia(renderOptions);

			job.status = 'done';
			job.result = result;
			this.#completedCount++;
			this.#config.onJobComplete?.(job);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			job.status = 'error';
			job.error = error;
			this.#failedCount++;
			this.#config.onJobError?.(job, error);
		} finally {
			// Always release NVENC lease
			if (nvencLease && this.#nvencManager) {
				this.#nvencManager.release(nvencLease);
			}

			// Check if all work is done and notify waiters
			if (this.#queue.active <= 1 && this.#queue.pending === 0) {
				// active <= 1 because this job is still counted as active
				// until the queue's finally block runs
				const resolvers = this.#allDoneResolvers.splice(
					0,
					this.#allDoneResolvers.length,
				);
				for (const resolve of resolvers) {
					resolve();
				}
			}
		}
	}
}
