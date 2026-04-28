#!/usr/bin/env bun

import { listScenarioMatrix, longFlowCatalog, summarizeScenarioMatrix } from './regression-scenario-matrix';

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
  console.log('By user mindset:');
  for (const [mindset, count] of Object.entries(summary.byUserMindset)) {
    console.log(`- ${mindset}: ${count}`);
  }

  console.log('');
  console.log('By trust risk:');
  for (const [risk, count] of Object.entries(summary.byTrustRisk)) {
    console.log(`- ${risk}: ${count}`);
  }

  console.log('');
  console.log('By drop-off point:');
  for (const [point, count] of Object.entries(summary.byDropOffPoint)) {
    console.log(`- ${point}: ${count}`);
  }

  console.log('');
  console.log('By long flow:');
  for (const [flow, count] of Object.entries(summary.byLongFlow)) {
    console.log(`- ${flow}: ${count}`);
  }

  console.log('');
  console.log('Long flow catalog:');
  for (const item of longFlowCatalog) {
    console.log(`- ${item.id} | ${item.title} | ${item.userJourney}`);
  }

  console.log('');
  console.log('Scenario entries:');
  for (const entry of entries) {
    const longFlows = entry.longFlowIds?.join(',') ?? 'none';
    const mindsets = entry.userMindsets?.join(',') ?? 'none';
    console.log(
      `- ${entry.id} | ${entry.runner} | ${entry.domain} | ${entry.suite} | ${entry.branchLength} | longFlow=${longFlows} | mindsets=${mindsets} | ${entry.userGoal}`,
    );
    if (entry.expectedFeeling) {
      console.log(`  expectedFeeling: ${entry.expectedFeeling}`);
    }
  }
}

main();
