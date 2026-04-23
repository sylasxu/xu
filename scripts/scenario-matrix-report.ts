#!/usr/bin/env bun

import { listScenarioMatrix, summarizeScenarioMatrix } from './regression-scenario-matrix';

function main(): void {
  const entries = listScenarioMatrix();
  const summary = summarizeScenarioMatrix(entries);

  console.log('=== Scenario Matrix Summary ===');
  console.log(`Total scenarios: ${summary.total}`);
  console.log('');
  console.log('By layer:');
  for (const [layer, count] of Object.entries(summary.byLayer)) {
    console.log(`- ${layer}: ${count}`);
  }

  console.log('');
  console.log('By domain:');
  for (const [domain, count] of Object.entries(summary.byDomain)) {
    console.log(`- ${domain}: ${count}`);
  }

  console.log('');
  console.log('Scenario entries:');
  for (const entry of entries) {
    console.log(`- ${entry.id} | ${entry.runner} | ${entry.domain} | ${entry.suite} | ${entry.branchLength} | ${entry.userGoal}`);
  }
}

main();
