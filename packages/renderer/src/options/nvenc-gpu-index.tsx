import type {AnyRemotionOption} from './option';

const cliFlag = 'nvenc-gpu-index' as const;

let currentValue: number | null = null;

export const nvencGpuIndexOption = {
	name: 'NVENC GPU Index',
	cliFlag,
	description: () =>
		`
			Specifies which GPU to use for NVENC hardware encoding.
			Only relevant when using NVENC (NVIDIA) hardware acceleration.
			Default is 0 (first GPU). Set to 1, 2, etc. for multi-GPU systems.
		`,
	ssrName: 'nvencGpuIndex' as const,
	docLink: null,
	type: 0 as number | null,
	getValue: ({commandLine}) => {
		if (commandLine[cliFlag] !== undefined) {
			const value = Number(commandLine[cliFlag]);
			if (Number.isNaN(value) || value < 0 || !Number.isInteger(value)) {
				throw new Error(
					`Invalid value for --${cliFlag}: ${commandLine[cliFlag]}. Must be a non-negative integer.`,
				);
			}

			return {
				source: 'cli',
				value,
			};
		}

		if (currentValue !== null) {
			return {
				source: 'config',
				value: currentValue,
			};
		}

		return {
			source: 'default',
			value: null,
		};
	},
	setConfig: (value: number | null) => {
		if (value !== null) {
			if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
				throw new Error(
					`Invalid value for ${cliFlag}: ${value}. Must be a non-negative integer.`,
				);
			}
		}

		currentValue = value;
	},
	id: cliFlag,
} satisfies AnyRemotionOption<number | null>;
