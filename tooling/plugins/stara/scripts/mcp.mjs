import { launchStaraMcp, startupDiagnostic } from './launch.mjs';

try {
  await launchStaraMcp();
} catch {
  // stdout belongs exclusively to the existing MCP transport.
  console.error(startupDiagnostic);
  process.exitCode = 1;
}
