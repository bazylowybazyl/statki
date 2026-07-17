import { run100kBenchmark } from '../src/benchmark/benchmark100k.js';

const result = run100kBenchmark();
console.log(JSON.stringify(result, null, 2));

if (result.totalHexes !== 100000 || result.activeHexes !== 100000) process.exitCode = 1;
if (result.contactTicks === 0 || result.commandBacklog !== 0) process.exitCode = 1;
if (result.structuralCpuBytes > 48 * 1024 * 1024) process.exitCode = 1;

