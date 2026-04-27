#!/usr/bin/env bun

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listScenarioMatrix, type ScenarioMatrixEntry } from './regression-scenario-matrix';

interface ArtifactScenario {
  id: string;
  passed: boolean;
  matrix?: {
    domain: string;
    suite: string;
    layer: string;
  } | null;
}

interface RegressionArtifactFile {
  runner: string;
  suite: string;
  startedAt: string;
  completedAt: string;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  scenarios: ArtifactScenario[];
}

async function readLatestArtifact(runner: string): Promise<RegressionArtifactFile | null> {
  const dir = join(process.cwd(), '.artifacts', 'regression', runner);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();
  const latest = jsonFiles.at(-1);
  if (!latest) {
    return null;
  }

  const raw = await readFile(join(dir, latest), 'utf8');
  return JSON.parse(raw) as RegressionArtifactFile;
}

async function readArtifacts(runner: string): Promise<RegressionArtifactFile[]> {
  const dir = join(process.cwd(), '.artifacts', 'regression', runner);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const artifacts: RegressionArtifactFile[] = [];
  for (const file of files.filter((item) => item.endsWith('.json')).sort()) {
    try {
      const raw = await readFile(join(dir, file), 'utf8');
      artifacts.push(JSON.parse(raw) as RegressionArtifactFile);
    } catch {
      // Ignore malformed local artifacts; the report is best-effort.
    }
  }

  return artifacts;
}

function summarizeMatrix(entries: ScenarioMatrixEntry[]) {
  const byDomain = new Map<string, number>();
  const byRunner = new Map<string, number>();

  for (const entry of entries) {
    byDomain.set(entry.domain, (byDomain.get(entry.domain) ?? 0) + 1);
    byRunner.set(entry.runner, (byRunner.get(entry.runner) ?? 0) + 1);
  }

  return { byDomain, byRunner };
}

function summarizeArtifact(artifact: RegressionArtifactFile | null) {
  const coveredDomains = new Set<string>();
  const passedDomains = new Set<string>();

  if (!artifact) {
    return { coveredDomains, passedDomains };
  }

  for (const scenario of artifact.scenarios) {
    if (!scenario.matrix?.domain) {
      continue;
    }
    coveredDomains.add(scenario.matrix.domain);
    if (scenario.passed) {
      passedDomains.add(scenario.matrix.domain);
    }
  }

  return { coveredDomains, passedDomains };
}

function buildLatestScenarioResults(
  artifactsByRunner: Map<string, RegressionArtifactFile[]>,
): Map<string, { scenario: ArtifactScenario; artifact: RegressionArtifactFile }> {
  const latestByScenario = new Map<string, { scenario: ArtifactScenario; artifact: RegressionArtifactFile }>();

  for (const artifacts of artifactsByRunner.values()) {
    for (const artifact of artifacts) {
      for (const scenario of artifact.scenarios) {
        const previous = latestByScenario.get(scenario.id);
        if (!previous || artifact.startedAt > previous.artifact.startedAt) {
          latestByScenario.set(scenario.id, { scenario, artifact });
        }
      }
    }
  }

  return latestByScenario;
}

function readScenarioStatus(
  entry: ScenarioMatrixEntry,
  latestByScenario: Map<string, { scenario: ArtifactScenario; artifact: RegressionArtifactFile }>,
): { status: string; latestAt: string } {
  const latest = latestByScenario.get(entry.id);
  if (!latest) {
    return { status: 'no-latest-artifact', latestAt: 'none' };
  }

  return {
    status: latest.scenario.passed ? 'passed' : 'failed',
    latestAt: latest.artifact.startedAt,
  };
}

async function main(): Promise<void> {
  const matrix = listScenarioMatrix();
  const { byDomain, byRunner } = summarizeMatrix(matrix);
  const latestByRunner = new Map<string, RegressionArtifactFile | null>();
  const artifactsByRunner = new Map<string, RegressionArtifactFile[]>();
  for (const runner of byRunner.keys()) {
    latestByRunner.set(runner, await readLatestArtifact(runner));
    artifactsByRunner.set(runner, await readArtifacts(runner));
  }
  const latestByScenario = buildLatestScenarioResults(artifactsByRunner);

  const artifactSummaries = [...latestByRunner.values()].map((artifact) => summarizeArtifact(artifact));

  const combinedCoveredDomains = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.coveredDomains]),
  ]);

  console.log('=== Scenario Coverage Report ===');
  console.log(`Matrix scenarios: ${matrix.length}`);
  console.log('');

  console.log('By runner:');
  for (const [runner, count] of byRunner.entries()) {
    console.log(`- ${runner}: ${count}`);
  }

  console.log('');
  console.log('By domain:');
  for (const [domain, count] of byDomain.entries()) {
    const covered = combinedCoveredDomains.has(domain) ? 'covered-by-latest-artifact' : 'not-seen-in-latest-artifacts';
    console.log(`- ${domain}: ${count} (${covered})`);
  }

  console.log('');
  console.log('Latest artifacts:');
  for (const [runner, artifact] of latestByRunner.entries()) {
    if (artifact) {
      console.log(`- ${runner}: ${artifact.startedAt} | passed=${artifact.passedCount}/${artifact.scenarioCount}`);
    } else {
      console.log(`- ${runner}: none`);
    }
  }

  console.log('');
  console.log('Scenario latest status:');
  for (const entry of matrix) {
    const { status, latestAt } = readScenarioStatus(entry, latestByScenario);
    console.log(`- ${entry.id}: ${status} | runner=${entry.runner} | suite=${entry.suite} | domain=${entry.domain} | latest=${latestAt}`);
  }
}

await main();
