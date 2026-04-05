import type {Codec} from './codec';
import type {LogLevel} from './log-level';
import {Log} from './logger';
import {isNvencAvailableCached} from './nvenc-detection';
import type {HardwareAccelerationOption} from './options/hardware-acceleration';

export type CodecSettings = {
	encoderName: string;
	hardwareAccelerated: boolean;
};

export const hasSpecifiedUnsupportedHardwareQualifySettings = ({
	encodingMaxRate,
	encodingBufferSize,
	crf,
	nvencSupported,
}: {
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	crf: unknown;
	nvencSupported?: boolean;
}) => {
	if (encodingBufferSize !== null) {
		return 'encodingBufferSize';
	}

	if (encodingMaxRate !== null) {
		return 'encodingMaxRate';
	}

	// NVENC supports CRF via -cq (constant quality), so don't flag it
	// as unsupported when NVENC is available
	if (crf !== null && typeof crf !== 'undefined' && !nvencSupported) {
		return 'crf';
	}

	return null;
};

export const getCodecName = ({
	codec,
	encodingMaxRate,
	encodingBufferSize,
	crf,
	hardwareAcceleration,
	logLevel,
	indent,
}: {
	codec: Codec;
	hardwareAcceleration: HardwareAccelerationOption;
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	crf: unknown;
	logLevel: LogLevel;
	indent: boolean;
}): CodecSettings | null => {
	const preferredHwAcceleration =
		hardwareAcceleration === 'required' ||
		hardwareAcceleration === 'if-possible';

	// Check if NVENC is potentially available on this platform
	const nvencPlatform =
		process.platform === 'linux' || process.platform === 'win32';
	const nvencSupported = nvencPlatform && isNvencAvailableCached();

	const unsupportedQualityOption =
		hasSpecifiedUnsupportedHardwareQualifySettings({
			encodingMaxRate,
			encodingBufferSize,
			crf,
			nvencSupported,
		});

	if (hardwareAcceleration === 'required' && unsupportedQualityOption) {
		throw new Error(
			`When using hardware accelerated encoding, the option "${unsupportedQualityOption}" with hardware acceleration is not supported. Disable hardware accelerated encoding or use "if-possible" instead.`,
		);
	}

	const warnAboutDisabledHardwareAcceleration = () => {
		if (hardwareAcceleration === 'if-possible' && unsupportedQualityOption) {
			Log.warn(
				{indent, logLevel},
				`${indent ? '' : '\n'}Hardware accelerated encoding disabled - "${unsupportedQualityOption}" option is not supported with hardware acceleration`,
			);
		}
	};

	if (codec === 'prores') {
		if (
			preferredHwAcceleration &&
			process.platform === 'darwin' &&
			!unsupportedQualityOption
		) {
			return {encoderName: 'prores_videotoolbox', hardwareAccelerated: true};
		}

		warnAboutDisabledHardwareAcceleration();

		return {encoderName: 'prores_ks', hardwareAccelerated: false};
	}

	if (codec === 'h264') {
		if (
			preferredHwAcceleration &&
			process.platform === 'darwin' &&
			!unsupportedQualityOption
		) {
			return {encoderName: 'h264_videotoolbox', hardwareAccelerated: true};
		}

		if (
			preferredHwAcceleration &&
			(process.platform === 'linux' || process.platform === 'win32')
		) {
			if (isNvencAvailableCached()) {
				return {encoderName: 'h264_nvenc', hardwareAccelerated: true};
			}

			if (hardwareAcceleration === 'required') {
				throw new Error(
					'NVENC hardware acceleration is required but h264_nvenc encoder is not available. Ensure NVIDIA drivers and a supported GPU are installed.',
				);
			}

			Log.warn(
				{indent, logLevel},
				`${indent ? '' : '\n'}NVENC hardware acceleration not available, falling back to software encoding (libx264)`,
			);
		}

		warnAboutDisabledHardwareAcceleration();

		return {encoderName: 'libx264', hardwareAccelerated: false};
	}

	if (codec === 'h265') {
		if (
			preferredHwAcceleration &&
			process.platform === 'darwin' &&
			!unsupportedQualityOption
		) {
			return {encoderName: 'hevc_videotoolbox', hardwareAccelerated: true};
		}

		if (
			preferredHwAcceleration &&
			(process.platform === 'linux' || process.platform === 'win32')
		) {
			if (isNvencAvailableCached()) {
				return {encoderName: 'hevc_nvenc', hardwareAccelerated: true};
			}

			if (hardwareAcceleration === 'required') {
				throw new Error(
					'NVENC hardware acceleration is required but hevc_nvenc encoder is not available. Ensure NVIDIA drivers and a supported GPU are installed.',
				);
			}

			Log.warn(
				{indent, logLevel},
				`${indent ? '' : '\n'}NVENC hardware acceleration not available, falling back to software encoding (libx265)`,
			);
		}

		warnAboutDisabledHardwareAcceleration();

		return {encoderName: 'libx265', hardwareAccelerated: false};
	}

	if (codec === 'vp8') {
		return {encoderName: 'libvpx', hardwareAccelerated: false};
	}

	if (codec === 'vp9') {
		return {encoderName: 'libvpx-vp9', hardwareAccelerated: false};
	}

	if (codec === 'av1') {
		Log.warn(
			{indent, logLevel},
			'AV1 encoding is significantly slower than other codecs.',
		);
		return {encoderName: 'libaom-av1', hardwareAccelerated: false};
	}

	if (codec === 'gif') {
		return {encoderName: 'gif', hardwareAccelerated: false};
	}

	if (codec === 'mp3') {
		return null;
	}

	if (codec === 'aac') {
		return null;
	}

	if (codec === 'wav') {
		return null;
	}

	if (codec === 'h264-mkv') {
		if (
			preferredHwAcceleration &&
			(process.platform === 'linux' || process.platform === 'win32') &&
			isNvencAvailableCached()
		) {
			return {encoderName: 'h264_nvenc', hardwareAccelerated: true};
		}

		return {encoderName: 'libx264', hardwareAccelerated: false};
	}

	if (codec === 'h264-ts') {
		if (
			preferredHwAcceleration &&
			(process.platform === 'linux' || process.platform === 'win32') &&
			isNvencAvailableCached()
		) {
			return {encoderName: 'h264_nvenc', hardwareAccelerated: true};
		}

		return {encoderName: 'libx264', hardwareAccelerated: false};
	}

	throw new Error(`Could not get codec for ${codec satisfies never}`);
};
