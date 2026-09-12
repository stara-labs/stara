import { codeql } from '../lib/codeql.mjs';
import { createRuntime } from '../lib/process.mjs';

try {
  const runId = process.env.STARA_CODEQL_RUN_ID;
  if (runId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(runId)) {
    throw new Error('Invalid CodeQL gate run identifier');
  }
  await codeql(createRuntime({ runId }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
