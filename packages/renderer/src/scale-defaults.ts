import {getCpuCount} from './get-cpu-count';

export const SCALE_DEFAULTS = {
	/** Lower JPEG quality for intermediate frames (default 80 -> 70) */
	jpegQuality: 70,

	/** Conservative concurrency per job when many jobs are active */
	concurrencyPerJob: 4,

	/** Pages per browser in pool mode */
	pagesPerBrowser: 8,

	/** How many browsers to run */
	maxBrowsers: (cpuCount?: number) =>
		Math.ceil((cpuCount ?? getCpuCount()) / 8),

	/** Tab cycling interval scales with tab count */
	cycleIntervalMs: (totalTabs: number) =>
		Math.max(200, Math.min(2000, totalTabs * 25)),

	/** Offthread video threads per job at scale */
	offthreadVideoThreads: 1,

	/** Video threads flag for Chrome */
	videoThreadsPerJob: (cpuCount: number, activeJobs: number) =>
		Math.max(1, Math.floor(cpuCount / (activeJobs * 2))),
};

/** Returns recommended settings given the number of concurrent jobs planned */
export const getRecommendedScaleConfig = (concurrentJobs: number) => {
	const cpus = getCpuCount();
	return {
		concurrencyPerJob: Math.max(
			1,
			Math.min(4, Math.floor(cpus / concurrentJobs)),
		),
		maxBrowsers: Math.max(
			2,
			Math.ceil(concurrentJobs / SCALE_DEFAULTS.pagesPerBrowser),
		),
		jpegQuality: concurrentJobs > 10 ? 70 : 80,
		offthreadVideoThreads: concurrentJobs > 10 ? 1 : 2,
		cycleIntervalMs: SCALE_DEFAULTS.cycleIntervalMs(concurrentJobs * 4),
	};
};
