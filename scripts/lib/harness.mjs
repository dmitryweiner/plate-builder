// The browser scripts' harness is maker-kit's (`maker-kit/harness`: flags,
// the vite server, pages that collect console errors, steps and the run,
// downloads, STL files, throttling); this adds Plate Builder's own ports.
// Repository rule: extend these instead of writing throw-away scripts
// (AGENTS.md).

import { launch as kitLaunch } from 'maker-kit/harness';

export { binaryStl, check, download, horizontalOverflow, parseArgs, settled, throttle, VIEWPORTS } from 'maker-kit/harness';

/**
 * Ports of this project's own, with --strictPort: another project's server
 * on Vite's default 5173 is never tested by mistake.
 */
export const PORTS = { dev: 5373, preview: 4373 };

/** The kit's launch on Plate Builder's ports. */
export const launch = ({ preview = false } = {}) => kitLaunch({ preview, ports: PORTS });
