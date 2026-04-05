import {getCpuCount} from './get-cpu-count';
import type {LogLevel} from './log-level';
import {Log} from './logger';

export const resolveConcurrency = (
	userPreference: number | string | null,
	options?: {logLevel?: LogLevel; indent?: boolean},
) => {
	const maxCpus = getCpuCount();

	if (userPreference === null) {
		return Math.round(Math.min(8, Math.max(1, maxCpus / 2)));
	}

	const min = 1;
	let rounded;

	if (typeof userPreference === 'string') {
		const percentage = parseInt(userPreference.slice(0, -1), 10);
		rounded = Math.floor((percentage / 100) * maxCpus);
	} else {
		rounded = Math.floor(userPreference);
	}

	if (rounded > maxCpus) {
		Log.warn(
			{
				indent: options?.indent ?? false,
				logLevel: options?.logLevel ?? 'warn',
			},
			`Concurrency ${rounded} exceeds CPU count ${maxCpus}. Capping at ${maxCpus}.`,
		);
		rounded = maxCpus;
	}

	if (rounded < min) {
		throw new Error(`Minimum for concurrency is ${min}.`);
	}

	return rounded;
};

/** Returns the recommended per-job concurrency given the number of active jobs */
export const getRecommendedConcurrency = (activeJobs: number) => {
	const cpus = getCpuCount();
	return Math.max(1, Math.min(4, Math.floor(cpus / activeJobs)));
};
