import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';

export type CaptionWord = {
	text: string;
	startFrame: number;
	endFrame: number;
};

type Props = {
	words: CaptionWord[];
	style?: 'pop' | 'karaoke' | 'bounce' | 'glow';
	color?: string;
	highlightColor?: string;
	fontSize?: number;
	position?: 'bottom' | 'center' | 'top';
};

const WordSpan: React.FC<{
	word: CaptionWord;
	frame: number;
	style: string;
	color: string;
	highlightColor: string;
	fontSize: number;
}> = ({word, frame, style, color, highlightColor, fontSize}) => {
	const isActive = frame >= word.startFrame && frame <= word.endFrame;
	const progress = interpolate(
		frame,
		[word.startFrame, word.startFrame + 4],
		[0, 1],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	// Pop style — scale up on appear
	const popScale =
		style === 'pop'
			? interpolate(
					frame,
					[word.startFrame, word.startFrame + 3, word.startFrame + 6],
					[0.5, 1.3, 1],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			: 1;

	// Bounce style
	const bounceY =
		style === 'bounce' && isActive
			? interpolate(
					Math.sin(((frame - word.startFrame) / 3) * Math.PI),
					[-1, 1],
					[0, -8],
				)
			: 0;

	// Glow style
	const glowIntensity =
		style === 'glow' && isActive
			? interpolate(
					frame,
					[word.startFrame, word.startFrame + 5],
					[0, 15],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			: 0;

	// Karaoke — fill from left
	const karaokeFill =
		style === 'karaoke'
			? interpolate(
					frame,
					[word.startFrame, word.endFrame],
					[0, 100],
					{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
				)
			: isActive
				? 100
				: 0;

	const textColor = isActive ? highlightColor : color;

	return (
		<span
			style={{
				display: 'inline-block',
				fontSize,
				fontWeight: 900,
				fontFamily: "'Inter', 'Montserrat', sans-serif",
				color: style === 'karaoke' ? color : textColor,
				transform: `scale(${popScale}) translateY(${bounceY}px)`,
				opacity: interpolate(progress, [0, 1], [0.4, 1]),
				textShadow:
					glowIntensity > 0
						? `0 0 ${glowIntensity}px ${highlightColor}, 0 0 ${glowIntensity * 2}px ${highlightColor}`
						: '2px 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)',
				marginRight: 12,
				letterSpacing: '-0.02em',
				WebkitTextStroke: '1px rgba(0,0,0,0.3)',
				...(style === 'karaoke'
					? {
							background: `linear-gradient(90deg, ${highlightColor} ${karaokeFill}%, ${color} ${karaokeFill}%)`,
							WebkitBackgroundClip: 'text',
							WebkitTextFillColor: 'transparent',
							textShadow: 'none',
						}
					: {}),
			}}
		>
			{word.text}
		</span>
	);
};

export const ViralCaption: React.FC<Props> = ({
	words,
	style = 'pop',
	color = '#FFFFFF',
	highlightColor = '#FFE135',
	fontSize = 52,
	position = 'bottom',
}) => {
	const frame = useCurrentFrame();

	// Group words into lines of ~4 words
	const lines: CaptionWord[][] = [];
	let currentLine: CaptionWord[] = [];
	for (const word of words) {
		currentLine.push(word);
		if (currentLine.length >= 4) {
			lines.push(currentLine);
			currentLine = [];
		}
	}
	if (currentLine.length > 0) lines.push(currentLine);

	// Find active line
	const activeLineIndex = lines.findIndex((line) =>
		line.some((w) => frame >= w.startFrame && frame <= w.endFrame + 10),
	);

	const activeLine = activeLineIndex >= 0 ? lines[activeLineIndex] : null;
	if (!activeLine) return null;

	const posY = position === 'bottom' ? '75%' : position === 'center' ? '50%' : '25%';

	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				right: 0,
				top: posY,
				transform: 'translateY(-50%)',
				display: 'flex',
				justifyContent: 'center',
				flexWrap: 'wrap',
				padding: '0 40px',
				zIndex: 100,
			}}
		>
			{activeLine.map((word, i) => (
				<WordSpan
					key={`${word.startFrame}-${i}`}
					word={word}
					frame={frame}
					style={style}
					color={color}
					highlightColor={highlightColor}
					fontSize={fontSize}
				/>
			))}
		</div>
	);
};
