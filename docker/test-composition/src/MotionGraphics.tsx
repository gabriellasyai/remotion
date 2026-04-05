import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

// ── Progress Bar (TikTok style) ────────────────────────────
export const ProgressBar: React.FC<{color?: string}> = ({
	color = '#FFE135',
}) => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const progress = (frame / durationInFrames) * 100;

	return (
		<div
			style={{
				position: 'absolute',
				bottom: 0,
				left: 0,
				right: 0,
				height: 4,
				backgroundColor: 'rgba(255,255,255,0.2)',
				zIndex: 200,
			}}
		>
			<div
				style={{
					width: `${progress}%`,
					height: '100%',
					backgroundColor: color,
					transition: 'width 0.03s linear',
				}}
			/>
		</div>
	);
};

// ── Animated Lower Third ───────────────────────────────────
export const LowerThird: React.FC<{
	title: string;
	subtitle: string;
	startFrame: number;
	endFrame: number;
	color?: string;
}> = ({title, subtitle, startFrame, endFrame, color = '#FFE135'}) => {
	const frame = useCurrentFrame();
	if (frame < startFrame || frame > endFrame) return null;

	const slideIn = interpolate(
		frame,
		[startFrame, startFrame + 12],
		[-300, 0],
		{extrapolateRight: 'clamp'},
	);
	const slideOut = interpolate(
		frame,
		[endFrame - 10, endFrame],
		[0, -300],
		{extrapolateLeft: 'clamp'},
	);
	const x = frame > endFrame - 10 ? slideOut : slideIn;

	return (
		<div
			style={{
				position: 'absolute',
				bottom: 120,
				left: 40,
				transform: `translateX(${x}px)`,
				zIndex: 150,
			}}
		>
			<div
				style={{
					backgroundColor: color,
					color: '#000',
					padding: '8px 20px',
					fontSize: 28,
					fontWeight: 900,
					fontFamily: "'Inter', sans-serif",
					borderRadius: '4px 4px 0 0',
				}}
			>
				{title}
			</div>
			<div
				style={{
					backgroundColor: 'rgba(0,0,0,0.85)',
					color: '#fff',
					padding: '6px 20px',
					fontSize: 20,
					fontFamily: "'Inter', sans-serif",
					borderRadius: '0 0 4px 4px',
				}}
			>
				{subtitle}
			</div>
		</div>
	);
};

// ── Zoom Pulse Effect ──────────────────────────────────────
export const ZoomPulse: React.FC<{
	children: React.ReactNode;
	pulseFrames: number[];
	intensity?: number;
}> = ({children, pulseFrames, intensity = 1.08}) => {
	const frame = useCurrentFrame();

	let scale = 1;
	for (const pf of pulseFrames) {
		if (frame >= pf && frame <= pf + 10) {
			scale = interpolate(frame, [pf, pf + 3, pf + 10], [1, intensity, 1], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			});
			break;
		}
	}

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				transform: `scale(${scale})`,
				transformOrigin: 'center center',
			}}
		>
			{children}
		</div>
	);
};

// ── Cinematic Bars ─────────────────────────────────────────
export const CinematicBars: React.FC<{
	startFrame: number;
	endFrame: number;
	height?: number;
}> = ({startFrame, endFrame, height = 80}) => {
	const frame = useCurrentFrame();
	if (frame < startFrame || frame > endFrame) return null;

	const barHeight = interpolate(
		frame,
		[startFrame, startFrame + 15, endFrame - 15, endFrame],
		[0, height, height, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	return (
		<>
			<div
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					height: barHeight,
					backgroundColor: '#000',
					zIndex: 90,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					bottom: 0,
					left: 0,
					right: 0,
					height: barHeight,
					backgroundColor: '#000',
					zIndex: 90,
				}}
			/>
		</>
	);
};

// ── Particle Overlay ───────────────────────────────────────
export const ParticleOverlay: React.FC<{count?: number}> = ({count = 20}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const particles = Array.from({length: count}, (_, i) => {
		const seed = i * 137.508;
		const x = ((seed * 7.3) % width);
		const baseY = ((seed * 13.1) % height);
		const y = (baseY - frame * (1 + (i % 3))) % height;
		const size = 2 + (i % 4);
		const opacity = 0.1 + (i % 5) * 0.08;

		return (
			<div
				key={i}
				style={{
					position: 'absolute',
					left: x,
					top: y < 0 ? y + height : y,
					width: size,
					height: size,
					borderRadius: '50%',
					backgroundColor: `rgba(255, 225, 53, ${opacity})`,
					zIndex: 80,
				}}
			/>
		);
	});

	return <>{particles}</>;
};

// ── Shake Effect ───────────────────────────────────────────
export const ShakeEffect: React.FC<{
	children: React.ReactNode;
	shakeFrames: number[];
	intensity?: number;
}> = ({children, shakeFrames, intensity = 5}) => {
	const frame = useCurrentFrame();

	let offsetX = 0;
	let offsetY = 0;
	for (const sf of shakeFrames) {
		if (frame >= sf && frame <= sf + 6) {
			const progress = frame - sf;
			const decay = interpolate(progress, [0, 6], [1, 0]);
			offsetX = Math.sin(progress * 8) * intensity * decay;
			offsetY = Math.cos(progress * 6) * intensity * decay;
			break;
		}
	}

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				transform: `translate(${offsetX}px, ${offsetY}px)`,
			}}
		>
			{children}
		</div>
	);
};

// ── Vignette ───────────────────────────────────────────────
export const Vignette: React.FC<{intensity?: number}> = ({
	intensity = 0.6,
}) => {
	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${intensity}) 100%)`,
				zIndex: 85,
				pointerEvents: 'none',
			}}
		/>
	);
};

// ── Flash Transition ───────────────────────────────────────
export const FlashTransition: React.FC<{
	flashFrames: number[];
}> = ({flashFrames}) => {
	const frame = useCurrentFrame();

	let opacity = 0;
	for (const ff of flashFrames) {
		if (frame >= ff && frame <= ff + 4) {
			opacity = interpolate(frame, [ff, ff + 1, ff + 4], [0, 0.9, 0], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			});
			break;
		}
	}

	if (opacity <= 0) return null;

	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				backgroundColor: '#fff',
				opacity,
				zIndex: 300,
				pointerEvents: 'none',
			}}
		/>
	);
};
