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

async function main(): Promise<void> {
  const matrix = listScenarioMatrix();
  const { byDomain, byRunner } = summarizeMatrix(matrix);
  const latestSandbox = await readLatestArtifact('sandbox-regression');
  const latestChat = await readLatestArtifact('chat-regression');
  const latestIdentityMemory = await readLatestArtifact('identity-memory-regression');

  const sandboxSummary = summarizeArtifact(latestSandbox);
  const chatSummary = summarizeArtifact(latestChat);
  const identityMemorySummary = summarizeArtifact(latestIdentityMemory);

  const combinedCoveredDomains = new Set<string>([
    ...sandboxSummary.coveredDomains,
    ...chatSummary.coveredDomains,
    ...identityMemorySummary.coveredDomains,
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
  if (latestSandbox) {
    console.log(`- sandbox-regression: ${latestSandbox.startedAt} | passed=${latestSandbox.passedCount}/${latestSandbox.scenarioCount}`);
  } else {
    console.log('- sandbox-regression: none');
  }

  if (latestChat) {
    console.log(`- chat-regression: ${latestChat.startedAt} | passed=${latestChat.passedCount}/${latestChat.scenarioCount}`);
  } else {
    console.log('- chat-regression: none');
  }

  if (latestIdentityMemory) {
    console.log(`- identity-memory-regression: ${latestIdentityMemory.startedAt} | passed=${latestIdentityMemory.passedCount}/${latestIdentityMemory.scenarioCount}`);
  } else {
    console.log('- identity-memory-regression: none');
  }
}

await main();
