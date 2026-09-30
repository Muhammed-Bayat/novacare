import './config.js';
import { interpretQuestionnaireMessage } from './intake/gemini.js';
import { findQuestionnairePathway, type QuestionnaireInterpretation } from './intake/questionnaire.js';

interface AggregateResult {
  requests: number;
  outcomes: Record<string, number>;
  providerStatuses: Record<string, number>;
  failureCategories: Record<string, number>;
  retries: number;
  averageDurationMs: number;
}

const report = console.info;
const diagnostics: Record<string, unknown>[] = [];

// The production event is already safe, but suppress per-request output so this command reports aggregates only.
console.info = ((...args: unknown[]) => {
  if (args[0] === '[questionnaire-interpretation]' && typeof args[1] === 'string') {
    diagnostics.push(JSON.parse(args[1]) as Record<string, unknown>);
  }
}) as typeof console.info;

function summarize(results: QuestionnaireInterpretation[], entries: Record<string, unknown>[]): AggregateResult {
  const outcomes: Record<string, number> = {};
  const providerStatuses: Record<string, number> = {};
  const failureCategories: Record<string, number> = {};
  let retries = 0;
  let totalDurationMs = 0;
  for (const result of results) {
    const outcome = `${result.interpretationStatus}:${result.type}:${result.answerId ?? 'null'}`;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  for (const entry of entries) {
    if (Array.isArray(entry.providerStatuses)) {
      for (const status of entry.providerStatuses) {
        if (typeof status === 'number') providerStatuses[String(status)] = (providerStatuses[String(status)] ?? 0) + 1;
      }
    }
    if (typeof entry.finalFailureCategory === 'string') {
      failureCategories[entry.finalFailureCategory] = (failureCategories[entry.finalFailureCategory] ?? 0) + 1;
    }
    if (entry.retryAttempted === true) retries += 1;
    if (typeof entry.durationMs === 'number') totalDurationMs += entry.durationMs;
  }
  return {
    requests: results.length,
    outcomes,
    providerStatuses,
    failureCategories,
    retries,
    averageDurationMs: entries.length === 0 ? 0 : Math.round(totalDurationMs / entries.length),
  };
}

try {
  const question = findQuestionnairePathway('injury')?.questions.find((item) => item.id === 'weight_bearing');
  if (!question) throw new Error('Weight-bearing questionnaire question was not found.');

  const painfulResults: QuestionnaireInterpretation[] = [];
  for (let index = 0; index < 20; index += 1) {
    painfulResults.push(await interpretQuestionnaireMessage('injury', question, 'I can walk but it hurts quite badly.'));
  }
  const painfulDiagnostics = diagnostics.splice(0);
  const swellingResults = [await interpretQuestionnaireMessage('injury', question, 'My knee is swollen.')];
  const swellingDiagnostics = diagnostics.splice(0);
  const painful = summarize(painfulResults, painfulDiagnostics);
  const swelling = summarize(swellingResults, swellingDiagnostics);

  report(JSON.stringify({ model: process.env.GEMINI_MODEL, painful, swelling }));
  const painfulPassed = painful.outcomes['success:answer:painful'] === 20;
  const swellingPassed = swelling.outcomes['success:clarification-needed:null'] === 1;
  if (!painfulPassed || !swellingPassed) process.exitCode = 1;
} finally {
  console.info = report;
}
