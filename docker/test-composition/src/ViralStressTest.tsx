import React, {useMemo} from 'react';
import {
	AbsoluteFill,
	interpolate,
	OffthreadVideo,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import type {CaptionWord} from './ViralCaption';
import {ViralCaption} from './ViralCaption';
import {
	CinematicBars,
	FlashTransition,
	LowerThird,
	ParticleOverlay,
	ProgressBar,
	ShakeEffect,
	Vignette,
	ZoomPulse,
} from './MotionGraphics';

// ── Dialogue Script (real viral content feel) ──────────────
const SCRIPT: CaptionWord[] = [
	// Intro hook — 0-2s
	{text: 'PARA', startFrame: 0, endFrame: 8},
	{text: 'DE', startFrame: 8, endFrame: 14},
	{text: 'SCROLLAR', startFrame: 14, endFrame: 28},
	{text: 'AGORA!', startFrame: 28, endFrame: 42},

	// Problem — 2-5s
	{text: 'Você', startFrame: 60, endFrame: 70},
	{text: 'sabia', startFrame: 70, endFrame: 80},
	{text: 'que', startFrame: 80, endFrame: 88},
	{text: '90%', startFrame: 88, endFrame: 102},
	{text: 'das', startFrame: 108, endFrame: 116},
	{text: 'pessoas', startFrame: 116, endFrame: 128},
	{text: 'estão', startFrame: 128, endFrame: 138},
	{text: 'fazendo', startFrame: 138, endFrame: 150},

	// Agitation — 5-8s
	{text: 'isso', startFrame: 150, endFrame: 160},
	{text: 'COMPLETAMENTE', startFrame: 160, endFrame: 180},
	{text: 'ERRADO?', startFrame: 180, endFrame: 200},
	{text: 'E', startFrame: 210, endFrame: 218},
	{text: 'o', startFrame: 218, endFrame: 224},
	{text: 'pior', startFrame: 224, endFrame: 236},

	// Solution tease — 8-12s
	{text: 'é', startFrame: 240, endFrame: 248},
	{text: 'que', startFrame: 248, endFrame: 256},
	{text: 'a', startFrame: 256, endFrame: 262},
	{text: 'solução', startFrame: 262, endFrame: 280},
	{text: 'é', startFrame: 286, endFrame: 294},
	{text: 'muito', startFrame: 294, endFrame: 306},
	{text: 'mais', startFrame: 306, endFrame: 318},
	{text: 'simples', startFrame: 318, endFrame: 336},

	// CTA — 12-15s
	{text: 'do', startFrame: 340, endFrame: 348},
	{text: 'que', startFrame: 348, endFrame: 356},
	{text: 'você', startFrame: 356, endFrame: 368},
	{text: 'imagina!', startFrame: 368, endFrame: 390},
	{text: 'SEGUE', startFrame: 400, endFrame: 416},
	{text: 'PRA', startFrame: 416, endFrame: 428},
	{text: 'MAIS', startFrame: 428, endFrame: 450},

	// Extended — 15-30s
	{text: 'Primeiro', startFrame: 480, endFrame: 500},
	{text: 'passo:', startFrame: 500, endFrame: 518},
	{text: 'entender', startFrame: 518, endFrame: 538},
	{text: 'o', startFrame: 538, endFrame: 544},
	{text: 'problema', startFrame: 544, endFrame: 570},

	{text: 'A', startFrame: 600, endFrame: 608},
	{text: 'maioria', startFrame: 608, endFrame: 628},
	{text: 'ignora', startFrame: 628, endFrame: 648},
	{text: 'esse', startFrame: 648, endFrame: 662},
	{text: 'detalhe', startFrame: 662, endFrame: 690},

	{text: 'Mas', startFrame: 720, endFrame: 732},
	{text: 'quem', startFrame: 732, endFrame: 746},
	{text: 'aplica', startFrame: 746, endFrame: 766},
	{text: 'isso', startFrame: 766, endFrame: 780},

	{text: 'consegue', startFrame: 810, endFrame: 838},
	{text: 'resultados', startFrame: 838, endFrame: 868},
	{text: 'INSANOS', startFrame: 868, endFrame: 900},

	// 30-45s
	{text: 'Segundo', startFrame: 930, endFrame: 950},
	{text: 'passo:', startFrame: 950, endFrame: 968},
	{text: 'você', startFrame: 968, endFrame: 982},
	{text: 'precisa', startFrame: 982, endFrame: 1002},

	{text: 'de', startFrame: 1002, endFrame: 1010},
	{text: 'consistência', startFrame: 1010, endFrame: 1050},
	{text: 'e', startFrame: 1060, endFrame: 1068},
	{text: 'disciplina', startFrame: 1068, endFrame: 1100},

	{text: 'Não', startFrame: 1120, endFrame: 1134},
	{text: 'existe', startFrame: 1134, endFrame: 1152},
	{text: 'atalho', startFrame: 1152, endFrame: 1176},
	{text: 'pra', startFrame: 1176, endFrame: 1190},
	{text: 'isso', startFrame: 1190, endFrame: 1210},

	// 45-60s
	{text: 'Terceiro', startFrame: 1260, endFrame: 1282},
	{text: 'e', startFrame: 1282, endFrame: 1290},
	{text: 'último', startFrame: 1290, endFrame: 1314},
	{text: 'passo:', startFrame: 1314, endFrame: 1336},

	{text: 'EXECUTE', startFrame: 1350, endFrame: 1380},
	{text: 'AGORA', startFrame: 1380, endFrame: 1410},
	{text: 'MESMO!', startFrame: 1410, endFrame: 1450},

	{text: 'Salva', startFrame: 1470, endFrame: 1490},
	{text: 'esse', startFrame: 1490, endFrame: 1506},
	{text: 'vídeo', startFrame: 1506, endFrame: 1524},
	{text: 'e', startFrame: 1530, endFrame: 1538},
	{text: 'compartilha', startFrame: 1538, endFrame: 1570},
	{text: 'com', startFrame: 1570, endFrame: 1582},
	{text: 'alguém', startFrame: 1582, endFrame: 1608},
	{text: 'que', startFrame: 1608, endFrame: 1620},
	{text: 'PRECISA', startFrame: 1620, endFrame: 1660},
	{text: 'ouvir', startFrame: 1660, endFrame: 1690},
	{text: 'isso!', startFrame: 1690, endFrame: 1750},
];

// Caption style rotation per section
const CAPTION_STYLES: Array<{
	style: 'pop' | 'karaoke' | 'bounce' | 'glow';
	color: string;
	highlight: string;
	position: 'bottom' | 'center' | 'top';
}> = [
	{style: 'pop', color: '#FFFFFF', highlight: '#FFE135', position: 'center'},
	{style: 'karaoke', color: '#FFFFFF', highlight: '#FF3B5C', position: 'bottom'},
	{style: 'bounce', color: '#FFFFFF', highlight: '#00E5FF', position: 'center'},
	{style: 'glow', color: '#FFFFFF', highlight: '#FFE135', position: 'bottom'},
	{style: 'pop', color: '#FFFFFF', highlight: '#FF6B35', position: 'center'},
];

type Props = {
	videoSrc: string;
};

export const ViralStressTest: React.FC<Props> = ({videoSrc}) => {
	const frame = useCurrentFrame();
	const {durationInFrames, fps} = useVideoConfig();

	// ── Ken Burns (slow zoom + pan) ────────────────────────
	const kenBurnsScale = interpolate(
		frame,
		[0, durationInFrames],
		[1.0, 1.2],
		{extrapolateRight: 'clamp'},
	);

	const kenBurnsX = interpolate(
		frame,
		[0, durationInFrames / 2, durationInFrames],
		[0, -20, 10],
		{extrapolateRight: 'clamp'},
	);

	const kenBurnsY = interpolate(
		frame,
		[0, durationInFrames / 3, (durationInFrames * 2) / 3, durationInFrames],
		[0, -10, 5, -5],
		{extrapolateRight: 'clamp'},
	);

	// ── Blur BG pulses (on emphasis words) ─────────────────
	const emphasisFrames = [28, 160, 180, 868, 1350, 1380, 1620];
	let bgBlur = 0;
	for (const ef of emphasisFrames) {
		if (frame >= ef && frame <= ef + 20) {
			bgBlur = interpolate(frame, [ef, ef + 5, ef + 20], [0, 6, 0], {
				extrapolateLeft: 'clamp',
				extrapolateRight: 'clamp',
			});
			break;
		}
	}

	// ── Select caption style based on time ─────────────────
	const sectionIndex = Math.floor(
		(frame / durationInFrames) * CAPTION_STYLES.length,
	);
	const captionStyle =
		CAPTION_STYLES[Math.min(sectionIndex, CAPTION_STYLES.length - 1)];

	// ── Pulse frames (zoom kicks on key moments) ───────────
	const pulseFrames = [0, 28, 88, 160, 262, 400, 570, 690, 868, 1050, 1350, 1450, 1620];
	const shakeFrames = [28, 180, 868, 1350, 1620];
	const flashFrames = [0, 400, 930, 1260, 1470];

	// ── Cinematic bars on certain sections ──────────────────
	const cinematicSections = [
		{start: Math.round(fps * 5), end: Math.round(fps * 8)},
		{start: Math.round(fps * 30), end: Math.round(fps * 35)},
		{start: Math.round(fps * 50), end: Math.round(fps * 55)},
	];

	// Active caption words for current time window
	const activeWords = useMemo(
		() => SCRIPT.filter((w) => w.endFrame <= durationInFrames),
		[durationInFrames],
	);

	return (
		<AbsoluteFill style={{backgroundColor: '#000'}}>
			{/* Layer 1: Video with Ken Burns + blur */}
			<ShakeEffect shakeFrames={shakeFrames} intensity={8}>
				<ZoomPulse pulseFrames={pulseFrames} intensity={1.06}>
					<AbsoluteFill
						style={{
							transform: `scale(${kenBurnsScale}) translate(${kenBurnsX}px, ${kenBurnsY}px)`,
							filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
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
				</ZoomPulse>
			</ShakeEffect>

			{/* Layer 2: Vignette */}
			<Vignette intensity={0.5} />

			{/* Layer 3: Particle overlay */}
			<ParticleOverlay count={25} />

			{/* Layer 4: Cinematic bars */}
			{cinematicSections.map((section, i) => (
				<CinematicBars
					key={i}
					startFrame={section.start}
					endFrame={section.end}
					height={60}
				/>
			))}

			{/* Layer 5: Animated captions */}
			<ViralCaption
				words={activeWords}
				style={captionStyle.style}
				color={captionStyle.color}
				highlightColor={captionStyle.highlight}
				fontSize={54}
				position={captionStyle.position}
			/>

			{/* Layer 6: Lower thirds */}
			<LowerThird
				title="DICA #1"
				subtitle="Entenda o problema antes de agir"
				startFrame={Math.round(fps * 5)}
				endFrame={Math.round(fps * 9)}
				color="#FFE135"
			/>
			<LowerThird
				title="DICA #2"
				subtitle="Consistência supera talento"
				startFrame={Math.round(fps * 16)}
				endFrame={Math.round(fps * 20)}
				color="#FF3B5C"
			/>
			<LowerThird
				title="DICA #3"
				subtitle="Execute agora, não amanhã"
				startFrame={Math.round(fps * 43)}
				endFrame={Math.round(fps * 48)}
				color="#00E5FF"
			/>

			{/* Layer 7: Flash transitions */}
			<FlashTransition flashFrames={flashFrames} />

			{/* Layer 8: Progress bar */}
			<ProgressBar color="#FFE135" />
		</AbsoluteFill>
	);
};
