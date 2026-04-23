import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RegressionArtifactScenario {
  id: string;
  passed: boolean;
  details: string[];
  error?: string;
  durationMs?: number;
  matrix?: {
    runner: string;
    layer: string;
    suite: string;
    domain: string;
    branchLength: string;
    userGoal: string;
    prdSections: string[];
    primarySurface: string;
    scenarioType: string;
  } | null;
}

export interface RegressionArtifact {
  runner: string;
  suite: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  scenarios: RegressionArtifactScenario[];
  metadata?: Record<string, unknown>;
}

function buildArtifactPath(runner: string, suite: string, startedAt: Date): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const rootDir = join(process.cwd(), '.artifacts', 'regression', runner);
  mkdirSync(rootDir, { recursive: true });
  return join(rootDir, `${stamp}-${suite}.json`);
}

export async function writeRegressionArtifact(artifact: RegressionArtifact): Promise<string> {
  const outputPath = buildArtifactPath(artifact.runner, artifact.suite, new Date(artifact.startedAt));
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return outputPath;
}
