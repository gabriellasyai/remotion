import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	interpolate,
	OffthreadVideo,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

type Subtitle = {
	start: number; // frame
	end: number; // frame
	text: string;
};

type Props = {
	videoSrc: string;
	subtitles: Subtitle[];
	enableZoom: boolean;
	enableBlur: boolean;
};

const SubtitleOverlay: React.FC<{subtitle: Subtitle; frame: number}> = ({
	subtitle,
	frame,
}) => {
	const opacity = interpolate(
		frame,
		[subtitle.start, subtitle.start + 10, subtitle.end - 10, subtitle.end],
		[0, 1, 1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	return (
		<div
			style={{
				position: 'absolute',
				bottom: 80,
				left: 0,
				right: 0,
				display: 'flex',
				justifyContent: 'center',
				opacity,
			}}
		>
			<div
				style={{
					backgroundColor: 'rgba(0, 0, 0, 0.75)',
					color: '#ffffff',
					fontSize: 42,
					fontFamily: 'sans-serif',
					fontWeight: 700,
					padding: '12px 32px',
					borderRadius: 8,
					textAlign: 'center',
					maxWidth: '80%',
					textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
				}}
			>
				{subtitle.text}
			</div>
		</div>
	);
};

export const VideoWithSubtitles: React.FC<Props> = ({
	videoSrc,
	subtitles,
	enableZoom,
	enableBlur,
}) => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();

	// Zoom: slowly scales from 1.0 to 1.15 over the clip duration
	const zoomScale = enableZoom
		? interpolate(frame, [0, durationInFrames], [1.0, 1.15], {
				extrapolateRight: 'clamp',
			})
		: 1;

	// Blur: pulses between 0 and 8px blur every ~5 seconds
	const blurAmount = enableBlur
		? interpolate(
				Math.sin((frame / 150) * Math.PI * 2),
				[-1, 1],
				[0, 8],
			)
		: 0;

	// Determine active subtitle
	const activeSubtitles = useMemo(
		() => subtitles.filter((s) => frame >= s.start && frame <= s.end),
		[subtitles, frame],
	);

	return (
		<AbsoluteFill style={{backgroundColor: '#000'}}>
			{/* Background layer with blur */}
			<AbsoluteFill
				style={{
					filter: blurAmount > 0 ? `blur(${blurAmount}px)` : undefined,
					transform: `scale(${zoomScale})`,
					transformOrigin: 'center center',
				}}
			>
				<OffthreadVideo
					src={videoSrc}
					style={{
						width: '100%',
						height: '100%',
						objectFit: 'cover',
					}}
				/>
			</AbsoluteFill>

			{/* Subtitle layer (no blur/zoom applied) */}
			{activeSubtitles.map((sub) => (
				<SubtitleOverlay key={sub.start} subtitle={sub} frame={frame} />
			))}

			{/* Debug overlay: frame counter */}
			<div
				style={{
					position: 'absolute',
					top: 16,
					right: 16,
					color: 'rgba(255,255,255,0.4)',
					fontSize: 14,
					fontFamily: 'monospace',
				}}
			>
				frame {frame} / {durationInFrames}
			</div>
		</AbsoluteFill>
	);
};
