import type {LogLevel} from './log-level';
import {getAvailableMemory} from './memory/get-available-memory';

const estimateMemoryUsageForPrestitcher = ({
	width,
	height,
	isHardwareAccelerated,
}: {
	width: number;
	height: number;
	isHardwareAccelerated?: boolean;
}) => {
	// When using hardware-accelerated encoding (e.g. NVENC), FFmpeg offloads
	// encoding to GPU VRAM, so system RAM usage is dramatically lower.
	if (isHardwareAccelerated) {
		return 200_000_000;
	}

	// Empirically we detected that per 1 million pixels, FFMPEG uses around 1GB of memory, relatively independent of
	// the duration of the video.
	const memoryUsageFor4K = 1_000_000_000;
	const memoryUsageOfPixel = memoryUsageFor4K / 1_000_000;

	return memoryUsageOfPixel * width * height;
};

export const shouldUseParallelEncoding = ({
	width,
	height,
	logLevel,
	isHardwareAccelerated,
}: {
	width: number;
	height: number;
	logLevel: LogLevel;
	isHardwareAccelerated?: boolean;
}) => {
	const freeMemory = getAvailableMemory(logLevel);
	const estimatedUsage = estimateMemoryUsageForPrestitcher({
		height,
		width,
		isHardwareAccelerated,
	});

	const hasEnoughMemory =
		freeMemory - estimatedUsage > 2_000_000_000 &&
		estimatedUsage / freeMemory < 0.5;

	return {
		hasEnoughMemory,
		freeMemory,
		estimatedUsage,
	};
};
