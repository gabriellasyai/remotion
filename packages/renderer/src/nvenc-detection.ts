import {callFf} from './call-ffmpeg';
import type {LogLevel} from './log-level';
import {Log} from './logger';

export const NVENC_SESSION_LIMITS = {
	consumer: Infinity,
	enterprise: Infinity,
} as const;

export type NvencGpuType = keyof typeof NVENC_SESSION_LIMITS;

let nvencAvailableCache: boolean | null = null;

/**
 * Returns the cached NVENC availability result.
 * Must call `initializeNvencDetection()` before using this.
 */
export const isNvencAvailableCached = (): boolean => {
	if (nvencAvailableCache === null) {
		// If not initialized, assume unavailable (safe fallback)
		return false;
	}

	return nvencAvailableCache;
};

/**
 * Returns the maximum number of concurrent NVENC sessions for a given GPU type.
 * Consumer GPUs (GeForce) are limited to 5 sessions.
 * Enterprise GPUs (Tesla T4, L4, A10, A100, etc.) have no limit.
 */
export const getNvencMaxSessions = (gpuType: NvencGpuType): number => {
	return NVENC_SESSION_LIMITS[gpuType];
};

/**
 * Probes FFmpeg to check if the h264_nvenc encoder is available.
 * Caches the result since NVENC availability does not change at runtime.
 */
export const initializeNvencDetection = async ({
	indent,
	logLevel,
	binariesDirectory,
}: {
	indent: boolean;
	logLevel: LogLevel;
	binariesDirectory: string | null;
}): Promise<boolean> => {
	if (nvencAvailableCache !== null) {
		return nvencAvailableCache;
	}

	// NVENC is only relevant on Linux and Windows
	if (process.platform !== 'linux' && process.platform !== 'win32') {
		Log.verbose(
			{indent, logLevel},
			'NVENC detection skipped: not on Linux or Windows',
		);
		nvencAvailableCache = false;
		return false;
	}

	try {
		const task = callFf({
			bin: 'ffmpeg',
			args: ['-hide_banner', '-encoders'],
			indent,
			logLevel,
			binariesDirectory,
			cancelSignal: undefined,
		});

		const {stdout} = await task;
		const hasH264Nvenc = stdout.includes('h264_nvenc');
		const hasHevcNvenc = stdout.includes('hevc_nvenc');

		nvencAvailableCache = hasH264Nvenc;

		if (hasH264Nvenc) {
			Log.verbose(
				{indent, logLevel},
				`NVENC detected: h264_nvenc=${hasH264Nvenc}, hevc_nvenc=${hasHevcNvenc}`,
			);
		} else {
			Log.verbose(
				{indent, logLevel},
				'NVENC not detected: h264_nvenc encoder not found in FFmpeg output',
			);
		}

		return hasH264Nvenc;
	} catch (err) {
		Log.verbose(
			{indent, logLevel},
			`NVENC detection failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		nvencAvailableCache = false;
		return false;
	}
};

/**
 * Resets the cached NVENC detection result.
 * Useful for testing.
 */
export const resetNvencDetectionCache = (): void => {
	nvencAvailableCache = null;
};
