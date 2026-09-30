import './config.js';
import { inspectConfiguredGeminiModel } from './intake/gemini.js';

const result = await inspectConfiguredGeminiModel();
console.info(`Gemini API configured: ${result.configured}`);
console.info(`Gemini model configured: ${result.model}`);
console.info(`Gemini model supports generateContent: ${result.supportsGenerateContent}`);
if (result.status !== undefined) console.info(`Gemini model diagnostic status: ${result.status}`);
if (result.reason) console.info(`Gemini model diagnostic reason: ${result.reason}`);
if (result.message) console.info(`Gemini model diagnostic message: ${result.message}`);
if (!result.supportsGenerateContent) process.exitCode = 1;
