#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const METRICS = ["runtimeConfigMs", "latencyMs", "totalRequestMs"];

function detectService(text) {
  if (text.includes("llm-dialogue request completed")) {
    return "llm-dialogue";
  }

  if (text.includes("tts request completed")) {
    return "tts";
  }

  return null;
}

function extractMetric(text, metric) {
  const pattern = new RegExp(`["']?${metric}["']?\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)`, "i");
  const match = text.match(pattern);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseBlock(blockText) {
  const service = detectService(blockText);
  if (!service) {
    return null;
  }

  const isPrewarm = /["']?prewarm["']?\s*[:=]\s*true/i.test(blockText);
  const values = {};
  for (const metric of METRICS) {
    const metricValue = extractMetric(blockText, metric);
    if (metricValue !== undefined) {
      values[metric] = metricValue;
    }
  }

  return { service, values, isPrewarm };
}

function collectCompletedRequestBlocks(content) {
  const blocks = [];
  const markerRegex = /(llm-dialogue request completed|tts request completed)/g;
  let markerMatch = markerRegex.exec(content);

  while (markerMatch) {
    const markerIndex = markerMatch.index;
    const nextMarkerIndex = (() => {
      const peek = markerRegex.exec(content);
      if (!peek) {
        return content.length;
      }
      // Reset cursor so outer loop can continue from the current marker.
      markerRegex.lastIndex = peek.index;
      return peek.index;
    })();

    const blockStart = markerIndex;
    const firstBraceIndex = content.indexOf("{", markerIndex);
    if (firstBraceIndex === -1 || firstBraceIndex > nextMarkerIndex) {
      // Fallback: keep just the marker line text.
      const lineEnd = content.indexOf("\n", markerIndex);
      blocks.push(content.slice(blockStart, lineEnd === -1 ? content.length : lineEnd));
      markerMatch = markerRegex.exec(content);
      continue;
    }

    let depth = 0;
    let endIndex = -1;
    for (let i = firstBraceIndex; i < content.length; i += 1) {
      const ch = content[i];
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      blocks.push(content.slice(blockStart, endIndex));
    } else {
      const lineEnd = content.indexOf("\n", markerIndex);
      blocks.push(content.slice(blockStart, lineEnd === -1 ? content.length : lineEnd));
    }

    markerRegex.lastIndex = endIndex !== -1 ? endIndex : markerIndex + 1;
    markerMatch = markerRegex.exec(content);
  }

  return blocks;
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }

  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }

  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function readInput(pathArg) {
  if (pathArg) {
    return readFile(pathArg, "utf8");
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function printServiceStats(service, metricValues) {
  console.log(`\nService: ${service}`);

  for (const metric of METRICS) {
    const values = metricValues[metric];
    if (values.length === 0) {
      continue;
    }

    const p50 = percentile(values, 50);
    const p95 = percentile(values, 95);
    const min = Math.min(...values);
    const max = Math.max(...values);

    console.log(
      `  ${metric}: count=${values.length} p50=${formatMs(p50)} p95=${formatMs(p95)} min=${formatMs(min)} max=${formatMs(max)}`
    );
  }
}

async function main() {
  const pathArg = process.argv[2];
  const optionalArgs = process.argv.slice(3);
  const serviceFilter = optionalArgs.find((arg) => arg === "llm-dialogue" || arg === "tts");
  const includePrewarm = optionalArgs.includes("--include-prewarm");

  const unknownArgs = optionalArgs.filter(
    (arg) => arg !== serviceFilter && arg !== "--include-prewarm"
  );
  if (unknownArgs.length > 0) {
    console.error(`Unknown arguments: ${unknownArgs.join(", ")}`);
    process.exit(1);
  }

  if (serviceFilter && serviceFilter !== "llm-dialogue" && serviceFilter !== "tts") {
    console.error("Invalid service filter. Use: llm-dialogue | tts");
    process.exit(1);
  }

  const content = await readInput(pathArg);
  const blocks = collectCompletedRequestBlocks(content);

  const serviceStats = {
    "llm-dialogue": { runtimeConfigMs: [], latencyMs: [], totalRequestMs: [] },
    tts: { runtimeConfigMs: [], latencyMs: [], totalRequestMs: [] },
  };

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (!parsed) {
      continue;
    }

    if (serviceFilter && parsed.service !== serviceFilter) {
      continue;
    }

    if (!includePrewarm && parsed.isPrewarm) {
      continue;
    }

    for (const metric of METRICS) {
      const value = parsed.values[metric];
      if (value !== undefined) {
        serviceStats[parsed.service][metric].push(value);
      }
    }
  }

  const servicesToPrint = serviceFilter ? [serviceFilter] : ["llm-dialogue", "tts"];
  let hasData = false;
  for (const service of servicesToPrint) {
    const totalCount = METRICS.reduce((sum, metric) => sum + serviceStats[service][metric].length, 0);
    if (totalCount > 0) {
      hasData = true;
      printServiceStats(service, serviceStats[service]);
    }
  }

  if (!hasData) {
    console.log("No matching latency records found. Provide raw CloudWatch log lines for completed requests.");
    process.exit(0);
  }
}

await main();
