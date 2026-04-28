#!/usr/bin/env bun

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listScenarioMatrix, longFlowCatalog, type ScenarioMatrixEntry } from './regression-scenario-matrix';

interface ArtifactScenario {
  id: string;
  passed: boolean;
  matrix?: {
    domain: string;
    suite: string;
    layer: string;
    branchLength?: string;
    userMindsets?: string[];
    trustRisks?: string[];
    dropOffPoints?: string[];
    longFlowIds?: string[];
    expectedFeeling?: string;
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
  const byMindset = new Map<string, number>();
  const byTrustRisk = new Map<string, number>();
  const byLongFlow = new Map<string, number>();

  for (const item of longFlowCatalog) {
    byLongFlow.set(item.id, 0);
  }

  const addValues = (target: Map<string, number>, values: string[] | undefined) => {
    for (const value of values ?? []) {
      target.set(value, (target.get(value) ?? 0) + 1);
    }
  };

  for (const entry of entries) {
    byDomain.set(entry.domain, (byDomain.get(entry.domain) ?? 0) + 1);
    byRunner.set(entry.runner, (byRunner.get(entry.runner) ?? 0) + 1);
    addValues(byMindset, entry.userMindsets);
    addValues(byTrustRisk, entry.trustRisks);
    addValues(byLongFlow, entry.longFlowIds);
  }

  return { byDomain, byRunner, byMindset, byTrustRisk, byLongFlow };
}

function summarizeScenarios(scenarios: ArtifactScenario[]) {
  const coveredDomains = new Set<string>();
  const passedDomains = new Set<string>();
  const coveredMindsets = new Set<string>();
  const coveredTrustRisks = new Set<string>();
  const coveredLongFlows = new Set<string>();
  const passedLongFlows = new Set<string>();

  for (const scenario of scenarios) {
    if (!scenario.matrix?.domain) {
      continue;
    }
    coveredDomains.add(scenario.matrix.domain);
    for (const mindset of scenario.matrix.userMindsets ?? []) {
      coveredMindsets.add(mindset);
    }
    for (const risk of scenario.matrix.trustRisks ?? []) {
      coveredTrustRisks.add(risk);
    }
    for (const longFlow of scenario.matrix.longFlowIds ?? []) {
      coveredLongFlows.add(longFlow);
      if (scenario.passed) {
        passedLongFlows.add(longFlow);
      }
    }
    if (scenario.passed) {
      passedDomains.add(scenario.matrix.domain);
    }
  }

  return { coveredDomains, passedDomains, coveredMindsets, coveredTrustRisks, coveredLongFlows, passedLongFlows };
}

function summarizeArtifact(artifact: RegressionArtifactFile | null) {
  return summarizeScenarios(artifact?.scenarios ?? []);
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
  const { byDomain, byRunner, byMindset, byTrustRisk, byLongFlow } = summarizeMatrix(matrix);
  const latestByRunner = new Map<string, RegressionArtifactFile | null>();
  const artifactsByRunner = new Map<string, RegressionArtifactFile[]>();
  for (const runner of byRunner.keys()) {
    latestByRunner.set(runner, await readLatestArtifact(runner));
    artifactsByRunner.set(runner, await readArtifacts(runner));
  }
  const latestByScenario = buildLatestScenarioResults(artifactsByRunner);
  const latestScenarioSummary = summarizeScenarios(
    [...latestByScenario.values()].map(({ scenario }) => scenario),
  );

  const artifactSummaries = [...latestByRunner.values()].map((artifact) => summarizeArtifact(artifact));

  const combinedCoveredDomains = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.coveredDomains]),
    ...latestScenarioSummary.coveredDomains,
  ]);
  const combinedCoveredMindsets = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.coveredMindsets]),
    ...latestScenarioSummary.coveredMindsets,
  ]);
  const combinedCoveredTrustRisks = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.coveredTrustRisks]),
    ...latestScenarioSummary.coveredTrustRisks,
  ]);
  const combinedCoveredLongFlows = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.coveredLongFlows]),
    ...latestScenarioSummary.coveredLongFlows,
  ]);
  const combinedPassedLongFlows = new Set<string>([
    ...artifactSummaries.flatMap((summary) => [...summary.passedLongFlows]),
    ...latestScenarioSummary.passedLongFlows,
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
  console.log('By user mindset:');
  for (const [mindset, count] of byMindset.entries()) {
    const covered = combinedCoveredMindsets.has(mindset) ? 'covered-by-latest-artifact' : 'not-seen-in-latest-artifacts';
    console.log(`- ${mindset}: ${count} (${covered})`);
  }

  console.log('');
  console.log('By trust risk:');
  for (const [risk, count] of byTrustRisk.entries()) {
    const covered = combinedCoveredTrustRisks.has(risk) ? 'covered-by-latest-artifact' : 'not-seen-in-latest-artifacts';
    console.log(`- ${risk}: ${count} (${covered})`);
  }

  console.log('');
  console.log('By long flow:');
  for (const [flow, count] of byLongFlow.entries()) {
    const covered = combinedCoveredLongFlows.has(flow) ? 'covered-by-latest-artifact' : 'not-seen-in-latest-artifacts';
    const passed = combinedPassedLongFlows.has(flow) ? 'latest-pass-seen' : 'latest-pass-not-seen';
    console.log(`- ${flow}: ${count} (${covered}, ${passed})`);
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
    const longFlows = entry.longFlowIds?.join(',') ?? 'none';
    console.log(
      `- ${entry.id}: ${status} | runner=${entry.runner} | suite=${entry.suite} | domain=${entry.domain} | longFlow=${longFlows} | latest=${latestAt}`,
    );
  }
}

await main();
