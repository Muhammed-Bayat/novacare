import cors from 'cors';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { recordAudit } from './audit.js';
import { loadMembership, requireHospital, requireRole } from './authorization.js';
import { createPostgresChannelConversationStore, type ChannelConversationStore } from './channels/conversation.store.js';
import { createChannelRequestContext, type ChannelRequestContext } from './channels/request-context.service.js';
import { getPool } from './db.js';
import { buildInvitationUrl, sendInvitationEmail } from './email.js';
import { createUssdCallbackHandler } from './ussd.controller.js';
import { createSmsIncomingHandler } from './sms.controller.js';
import { createDispatchController } from './dispatch/dispatch.controller.js';
import { createDispatchService } from './dispatch/dispatch.service.js';
import { createDispatchEventHub } from './dispatch/events.js';
import type { ChannelDispatchService } from './ussd.service.js';

type UserRow = { id: string; auth0_subject: string; email: string | null; display_name: string | null };
type QuestionnaireUrgency = 'emergency' | 'urgent' | 'priority' | 'routine';
type QuestionnaireQuestionType = 'single' | 'yes-no' | 'scale';
type QuestionnaireOption = { id: string; label: string; value: string | number | boolean };
type QuestionnaireQuestion = { id: string; text: string; helper?: string; type: QuestionnaireQuestionType; options?: QuestionnaireOption[]; min?: number; max?: number };
type QuestionnairePathway = { id: string; name: string; description: string; keywords: string[]; department: string; urgency: QuestionnaireUrgency; questions: QuestionnaireQuestion[] };
type QuestionnaireIntake = { pathwayId: string; pathwayName: string; summary: string; department: string; urgency: QuestionnaireUrgency; questions: QuestionnaireQuestion[]; source: 'gemini' | 'local' };
type AppointmentTriageSummary = { urgency: QuestionnaireUrgency; pathwayName: string; department: string; summary: string; redFlags: string[] };

const questionnairePathways: QuestionnairePathway[] = [
  {
    id: 'chest-breathing',
    name: 'Chest & breathing',
    description: 'Chest discomfort, breathing difficulty, palpitations or related symptoms.',
    keywords: ['chest', 'breath', 'breathing', 'shortness of breath', 'heart', 'palpitation'],
    department: 'Emergency Department',
    urgency: 'priority',
    questions: [
      { id: 'chest_now', text: 'Are you having chest pain or pressure right now?', helper: 'Choose the option that best reflects how you feel at this moment.', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'breath_now', text: 'Are you struggling to breathe or unable to speak comfortably in full sentences?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'pain_level', text: 'How severe is the discomfort?', helper: '0 means no pain and 10 means the worst pain you can imagine.', type: 'scale', min: 0, max: 10 },
      { id: 'radiating', text: 'Does the discomfort spread to your arm, jaw, shoulder or back?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
    ],
  },
  {
    id: 'injury',
    name: 'Injury & musculoskeletal',
    description: 'Recent falls, sports injuries, joint pain, swelling or difficulty moving.',
    keywords: ['knee', 'ankle', 'leg', 'arm', 'shoulder', 'injury', 'fell', 'fall', 'sports', 'swelling', 'fracture', 'sprain'],
    department: 'Orthopaedics',
    urgency: 'priority',
    questions: [
      { id: 'injury_timing', text: 'When did the injury happen?', type: 'single', options: [{ id: 'today', label: 'Today', value: 'today' }, { id: 'recent', label: '1-3 days ago', value: '1-3-days' }, { id: 'older', label: 'More than 3 days ago', value: 'older' }] },
      { id: 'weight_bearing', text: 'Can you use or put weight on the injured area?', type: 'single', options: [{ id: 'normal', label: 'Yes, normally', value: 'normal' }, { id: 'painful', label: 'Yes, but it is painful', value: 'painful' }, { id: 'no', label: 'No', value: 'no' }] },
      { id: 'deformity', text: 'Is there an obvious deformity, severe swelling, numbness or uncontrolled bleeding?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'pain_level', text: 'How severe is the pain?', type: 'scale', min: 0, max: 10 },
    ],
  },
  {
    id: 'abdominal',
    name: 'Abdominal symptoms',
    description: 'Stomach or abdominal pain, nausea, vomiting or digestive complaints.',
    keywords: ['stomach', 'abdomen', 'abdominal', 'belly', 'vomit', 'nausea', 'appendix', 'cramp'],
    department: 'General Medicine',
    urgency: 'priority',
    questions: [
      { id: 'pain_location', text: 'Where is the pain strongest?', type: 'single', options: [{ id: 'upper', label: 'Upper abdomen', value: 'upper' }, { id: 'lower_right', label: 'Lower right side', value: 'lower-right' }, { id: 'lower_left', label: 'Lower left side', value: 'lower-left' }, { id: 'general', label: 'All over / not sure', value: 'general' }] },
      { id: 'vomiting', text: 'Have you been vomiting repeatedly or been unable to keep fluids down?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'pain_level', text: 'How severe is the pain?', type: 'scale', min: 0, max: 10 },
      { id: 'fainting', text: 'Have you fainted, felt close to fainting, or noticed significant blood?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
    ],
  },
  {
    id: 'headache',
    name: 'Headache & neurological',
    description: 'Headache, dizziness, weakness, numbness or neurological symptoms.',
    keywords: ['headache', 'head', 'migraine', 'dizzy', 'dizziness', 'weakness', 'numb', 'vision'],
    department: 'General Medicine',
    urgency: 'priority',
    questions: [
      { id: 'sudden_onset', text: 'Did the headache reach severe intensity very suddenly?', helper: 'For example, becoming very severe within seconds or a few minutes.', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'neuro_signs', text: 'Do you have new weakness, facial drooping, difficulty speaking, confusion or loss of balance?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'pain_level', text: 'How severe is the headache?', type: 'scale', min: 0, max: 10 },
    ],
  },
  {
    id: 'general',
    name: 'General symptoms',
    description: 'Symptoms that do not clearly match one of the focused demo pathways.',
    keywords: [],
    department: 'General Medicine',
    urgency: 'routine',
    questions: [
      { id: 'severity', text: 'How unwell do you feel overall?', type: 'scale', min: 0, max: 10 },
      { id: 'worsening', text: 'Are your symptoms getting rapidly worse?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
      { id: 'danger_signs', text: 'Are you having severe breathing difficulty, fainting, uncontrolled bleeding, seizures or severe confusion?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
    ],
  },
];

function isBookingTime(date: string, time: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
    && date >= new Date().toISOString().slice(0, 10) && time >= '07:00' && time < '19:00';
}

function parseClock(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function sqlDateOnly(value: string): string {
  return value.slice(0, 10);
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value.map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an optional array of UUIDs; returns null when the value is not a valid list. */
function normalizeUuidList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  if (!value.every((item) => typeof item === 'string' && uuidPattern.test(item))) return null;
  return [...new Set(value.map((item) => String(item).toLowerCase()))];
}

function triageSummary(value: unknown): AppointmentTriageSummary | null | undefined {
  if (value === undefined || value === null) return null;
  const object = asObject(value);
  if (!object) return undefined;
  const urgency = object.urgency;
  const redFlags = textList(object.redFlags);
  if ((urgency !== 'emergency' && urgency !== 'urgent' && urgency !== 'priority' && urgency !== 'routine') || !redFlags) return undefined;
  const pathwayName = boundedText(object.pathwayName, '', 120);
  const department = boundedText(object.department, '', 120);
  const summary = boundedText(object.summary, '', 320);
  if (!pathwayName || !department || !summary) return undefined;
  return { urgency, pathwayName, department, summary, redFlags: redFlags.slice(0, 8) };
}

function invitationToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function platformOverseerEmail(): string {
  return (process.env.PLATFORM_OVERSEER_EMAIL ?? '2811604@students.wits.ac.za').trim().toLowerCase();
}

function fallbackQuestionnaire(complaint: string, source: 'gemini' | 'local' = 'local'): QuestionnaireIntake {
  const text = complaint.toLowerCase();
  let selected = questionnairePathways.find((pathway) => pathway.id === 'general')!;
  let bestScore = 0;
  for (const pathway of questionnairePathways.filter((item) => item.id !== 'general')) {
    const score = pathway.keywords.reduce((total, keyword) => total + (text.includes(keyword) ? Math.max(1, keyword.split(' ').length) : 0), 0);
    if (score > bestScore) {
      selected = pathway;
      bestScore = score;
    }
  }
  return {
    pathwayId: selected.id,
    pathwayName: selected.name,
    summary: selected.description,
    department: selected.department,
    urgency: selected.urgency,
    questions: selected.questions,
    source,
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedText(value: unknown, fallback: string, limit = 220): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : fallback;
}

function parseGeminiJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const jsonText = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(jsonText);
}

function normalizeQuestions(value: unknown, fallback: QuestionnaireQuestion[]): QuestionnaireQuestion[] {
  if (!Array.isArray(value)) return fallback;
  const questions = value.flatMap((item): QuestionnaireQuestion[] => {
    const question = asObject(item);
    if (!question) return [];
    const type = question.type;
    if (type !== 'single' && type !== 'yes-no' && type !== 'scale') return [];
    const id = boundedText(question.id, '', 60).replace(/[^a-z0-9_-]/gi, '_');
    const text = boundedText(question.text, '', 180);
    if (!id || !text) return [];
    if (type === 'scale') {
      const min = typeof question.min === 'number' ? question.min : 0;
      const max = typeof question.max === 'number' ? question.max : 10;
      return [{ id, text, helper: boundedText(question.helper, '', 160) || undefined, type, min, max }];
    }
    const options = Array.isArray(question.options) ? question.options.flatMap((option): QuestionnaireOption[] => {
      const optionObject = asObject(option);
      if (!optionObject) return [];
      const optionId = boundedText(optionObject.id, '', 40).replace(/[^a-z0-9_-]/gi, '_');
      const label = boundedText(optionObject.label, '', 80);
      const optionValue = optionObject.value;
      if (!optionId || !label || (typeof optionValue !== 'string' && typeof optionValue !== 'number' && typeof optionValue !== 'boolean')) return [];
      return [{ id: optionId, label, value: optionValue }];
    }) : [];
    return options.length >= 2 ? [{ id, text, helper: boundedText(question.helper, '', 160) || undefined, type, options }] : [];
  });
  return questions.length >= 2 ? questions.slice(0, 5) : fallback;
}

function normalizeQuestionnaire(value: unknown, complaint: string): QuestionnaireIntake {
  const fallback = fallbackQuestionnaire(complaint, 'gemini');
  const object = asObject(value);
  if (!object) return fallback;
  const urgency = object.urgency === 'emergency' || object.urgency === 'urgent' || object.urgency === 'priority' || object.urgency === 'routine' ? object.urgency : fallback.urgency;
  return {
    pathwayId: boundedText(object.pathwayId, fallback.pathwayId, 80),
    pathwayName: boundedText(object.pathwayName, fallback.pathwayName, 120),
    summary: boundedText(object.summary, fallback.summary, 260),
    department: boundedText(object.department, fallback.department, 120),
    urgency,
    questions: normalizeQuestions(object.questions, fallback.questions),
    source: 'gemini',
  };
}

function geminiText(payload: unknown): string | undefined {
  const response = asObject(payload);
  const candidates = response?.candidates;
  if (!Array.isArray(candidates)) return undefined;
  const firstCandidate = asObject(candidates[0]);
  const content = asObject(firstCandidate?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) return undefined;
  return parts.map((part) => asObject(part)?.text).filter((text): text is string => typeof text === 'string').join('\n').trim() || undefined;
}

async function buildQuestionnaireWithGemini(complaint: string): Promise<QuestionnaireIntake> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallbackQuestionnaire(complaint);
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  url.searchParams.set('key', apiKey);
  const prompt = `You are helping a South African patient portal prepare an intake questionnaire. Return only JSON with keys: pathwayId, pathwayName, summary, department, urgency, questions. urgency must be one of emergency, urgent, priority, routine. questions must be 2 to 5 short non-diagnostic questions with id, text, type, and options for single or yes-no questions, or min/max for scale questions. Do not give diagnosis or treatment. Complaint: ${complaint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error('Gemini questionnaire request failed');
  const text = geminiText(payload);
  if (!text) throw new Error('Gemini questionnaire response was empty');
  try {
    return normalizeQuestionnaire(parseGeminiJson(text), complaint);
  } catch {
    throw new Error('Gemini questionnaire response was invalid');
  }
}

const translationLanguageNames: Record<string, string> = {
  en: 'English',
  zu: 'isiZulu',
  xh: 'isiXhosa',
  af: 'Afrikaans',
  nso: 'Sepedi',
  st: 'Sesotho',
  tn: 'Setswana',
  ss: 'siSwati',
  ve: 'Tshivenda',
  ts: 'Xitsonga',
  nr: 'isiNdebele',
};

const translationCache = new Map<string, string>();

let geminiQuestionnaireCooldownUntil = 0;
const geminiQuestionnaireCooldownMs = 60_000;

async function translateOneWithGoogle(text: string, targetCode: string): Promise<string> {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', targetCode);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url);
    const payload: unknown = await response.json();
    if (!response.ok) {
      lastError = new Error(`Translation request failed: ${response.status}`);
      if (response.status !== 429 && response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    const segments = (payload as [unknown, ...unknown[]])[0];
    const translated = Array.isArray(segments)
      ? segments.map((segment) => (Array.isArray(segment) ? segment[0] : undefined)).filter((part): part is string => typeof part === 'string').join('')
      : '';
    if (!translated.trim()) { lastError = new Error('Translation response was empty'); break; }
    return translated;
  }
  throw lastError ?? new Error('Translation request failed');
}

async function translateTexts(texts: string[], targetCode: string): Promise<string[]> {
  const results: string[] = new Array(texts.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < texts.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await translateOneWithGoogle(texts[index], targetCode);
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, texts.length) }, worker));
  return results;
}

async function createAndSendInvitation(input: { hospitalId: string; hospitalName: string; email: string; role: 'administrator' | 'nurse' | 'doctor' | 'dispatcher'; invitedBy: string; baseUrl: string; departmentIds?: string[] }): Promise<{ claimUrl: string; emailSent: boolean }> {
  const token = invitationToken();
  const claimUrl = buildInvitationUrl(token, input.baseUrl);
  const departmentIds = input.role === 'administrator' || input.role === 'dispatcher' ? [] : (input.departmentIds ?? []);
  const invitation = await getPool().query(
    `INSERT INTO staff_invitations (hospital_id, email, role, invited_by, token_hash, expires_at, claimed_by, claimed_at, sent_at, department_ids)
     VALUES ($1, lower($2), $3, $4, $5, now() + interval '72 hours', NULL, NULL, NULL, $6)
     ON CONFLICT (hospital_id, email, role) DO UPDATE
     SET invited_by = EXCLUDED.invited_by, token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
         claimed_by = NULL, claimed_at = NULL, sent_at = NULL, department_ids = EXCLUDED.department_ids
     WHERE staff_invitations.claimed_at IS NULL`,
    [input.hospitalId, input.email, input.role, input.invitedBy, tokenHash(token), departmentIds],
  );
  if (!invitation.rowCount) throw new Error('This recipient has already claimed this hospital role.');
  // Roadmap 2.1: never block on email infrastructure — the admin UI shows the claim link as fallback.
  let emailSent = false;
  try {
    await sendInvitationEmail({ recipient: input.email, role: input.role, hospitalName: input.hospitalName, claimUrl });
    emailSent = true;
  } catch (error) {
    console.error('[invitation] email could not be sent, claim link shown in admin UI instead:', error instanceof Error ? error.message : error);
  }
  await getPool().query(
    `UPDATE staff_invitations SET sent_at = CASE WHEN $4 THEN now() ELSE NULL END
     WHERE hospital_id = $1 AND lower(email) = lower($2) AND role = $3 AND token_hash = $5`,
    [input.hospitalId, input.email, input.role, emailSent, tokenHash(token)],
  );
  return { claimUrl, emailSent };
}

async function synchronizeUser(subject: string, email: string | null, displayName: string | null): Promise<UserRow> {
  const result = await getPool().query<UserRow>(
    `INSERT INTO users (auth0_subject, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_subject) DO UPDATE
     SET email = COALESCE(EXCLUDED.email, users.email),
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         updated_at = now()
     RETURNING id, auth0_subject, email, display_name`,
    [subject, email, displayName],
  );
  const user = result.rows[0]!;
  if (email?.trim().toLowerCase() === platformOverseerEmail()) {
    await getPool().query('INSERT INTO platform_operators (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
  }
  return user;
}

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

type StaffRole = 'administrator' | 'nurse' | 'doctor' | 'dispatcher';
type StaffMembership = { userId: string; hospitalId: string; role: StaffRole };

async function staffMembership(subject: string, roles: StaffRole[]): Promise<StaffMembership | undefined> {
  const result = await getPool().query<{ user_id: string; hospital_id: string; role: StaffRole }>(
    `SELECT hm.user_id, hm.hospital_id, hm.role
     FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id
     WHERE u.auth0_subject = $1 AND hm.active AND hm.role = ANY($2)`,
    [subject, roles],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, hospitalId: row.hospital_id, role: row.role } : undefined;
}

const CATEGORY_RANK_SQL = `CASE category WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'priority' THEN 2 ELSE 3 END`;

export interface CreateAppOptions {
  channelDispatch?: ChannelDispatchService;
  channelStore?: ChannelConversationStore;
  channelContext?: ChannelRequestContext;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const origins = allowedOrigins();
  const dispatchHub = createDispatchEventHub();
  const dispatchService = createDispatchService({ publish: dispatchHub.publish });
  const channelDispatch = options.channelDispatch ?? dispatchService;
  const channelStore = options.channelStore ?? createPostgresChannelConversationStore();
  const channelContext = options.channelContext ?? createChannelRequestContext();

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
  app.use(express.json());
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode}`);
    });
    next();
  });

  function resolveBaseUrl(req: express.Request): string {
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) return origin;
    const configured = process.env.APP_BASE_URL;
    if (!configured) throw new Error('APP_BASE_URL is not configured');
    return configured;
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/v1/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const user = await synchronizeUser(auth.subject, auth.email, auth.displayName);
      const roles = await getPool().query<{ operator: boolean; role: string | null; hospital_id: string | null; hospital_name: string | null }>(
        `SELECT EXISTS(SELECT 1 FROM platform_operators WHERE user_id = $1) AS operator,
                (SELECT role FROM hospital_memberships WHERE user_id = $1 AND active) AS role,
                (SELECT hospital_id FROM hospital_memberships WHERE user_id = $1 AND active) AS hospital_id,
                (SELECT h.name FROM hospital_memberships hm JOIN hospitals h ON h.id = hm.hospital_id WHERE hm.user_id = $1 AND hm.active) AS hospital_name`, [user.id],
      );
      const access = roles.rows[0]!;
      const derivedUserType = access.role === 'administrator' ? 'admin' : access.role ? 'staff' : 'patient';
      res.json({ data: { id: user.id, auth0Subject: user.auth0_subject, email: user.email, displayName: user.display_name, userType: derivedUserType, isPlatformOperator: access.operator, staffRole: access.role, hospitalId: access.hospital_id, hospitalName: access.hospital_name } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/hospitals', requireAuth, async (req, res, next) => {
    try {
      const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
      const area = typeof req.query.area === 'string' ? req.query.area.trim() : '';
      const service = typeof req.query.service === 'string' ? req.query.service.trim() : '';
      const result = await getPool().query<{
        id: string; name: string; province: string; address: string; latitude: number; longitude: number; facility_type: string | null;
        service_id: string; service_name: string;
      }>(
        `SELECT h.id, h.name, h.province, h.address, h.latitude, h.longitude, h.facility_type,
                hs.id AS service_id, hs.name AS service_name
         FROM hospitals h
         JOIN departments hs ON hs.hospital_id = h.id AND hs.active
         WHERE h.active AND ($1 = '' OR h.name ILIKE '%' || $1 || '%')
           AND ($2 = '' OR h.province ILIKE '%' || $2 || '%' OR h.address ILIKE '%' || $2 || '%')
           AND ($3 = '' OR EXISTS (
             SELECT 1 FROM departments matching_service
             WHERE matching_service.hospital_id = h.id AND matching_service.active AND matching_service.name ILIKE '%' || $3 || '%'
           ))
         ORDER BY h.name, hs.name`,
        [name, area, service],
      );
      const hospitals = new Map<string, { id: string; name: string; province: string; address: string; latitude: number; longitude: number; facilityType: string | null; services: { id: string; name: string; waitingCount: number }[] }>();
      for (const row of result.rows) {
        const hospital = hospitals.get(row.id) ?? { id: row.id, name: row.name, province: row.province, address: row.address, latitude: row.latitude, longitude: row.longitude, facilityType: row.facility_type, services: [] };
        hospital.services.push({ id: row.service_id, name: row.service_name, waitingCount: 0 });
        hospitals.set(row.id, hospital);
      }
      const queueCounts = await getPool().query<{ service_id: string; waiting_count: number | string }>(
        `SELECT hospital_service_id AS service_id, COUNT(*) AS waiting_count
         FROM queue_entries
         WHERE queue_date = CURRENT_DATE AND status IN ('waiting', 'called', 'in_consultation')
         GROUP BY hospital_service_id`,
      );
      const waitingByService = new Map(queueCounts.rows.map((row) => [row.service_id, Number(row.waiting_count)]));
      for (const hospital of hospitals.values()) {
        for (const service of hospital.services) {
          service.waitingCount = waitingByService.get(service.id) ?? 0;
        }
      }
      res.json({ data: [...hospitals.values()] });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/questionnaire/intake', requireAuth, async (req, res, next) => {
    try {
      const { complaint } = req.body as { complaint?: unknown };
      if (typeof complaint !== 'string' || complaint.trim().length < 4 || complaint.trim().length > 300) {
        res.status(400).json({ error: { code: 'INVALID_QUESTIONNAIRE', message: 'Describe your main symptom in 4 to 300 characters.' } });
        return;
      }
      const trimmed = complaint.trim();
      let questionnaire: QuestionnaireIntake;
      if (Date.now() >= geminiQuestionnaireCooldownUntil) {
        try {
          questionnaire = await buildQuestionnaireWithGemini(trimmed);
        } catch (error) {
          geminiQuestionnaireCooldownUntil = Date.now() + geminiQuestionnaireCooldownMs;
          console.error('[questionnaire] Gemini unavailable, serving local fallback:', error instanceof Error ? error.message : error);
          questionnaire = fallbackQuestionnaire(trimmed);
        }
      } else {
        questionnaire = fallbackQuestionnaire(trimmed);
      }
      res.json({ data: questionnaire });
    } catch (error) {
      next(error);
    }
  });

  const intakeChatMaxTurns = 4;

  interface IntakeChatAnswer { question: string; answer: string }

  interface IntakeChatQuestion { id: string; text: string; type: 'yes_no' | 'single' | 'scale' | 'text'; options?: { id: string; label: string }[] }

  interface IntakeChatConclusion {
    pathwayId: string;
    pathwayName: string;
    summary: string;
    department: string;
    urgency: QuestionnaireUrgency;
    redFlags: string[];
  }

  type IntakeChatTurn =
    | { action: 'question'; question: IntakeChatQuestion }
    | { action: 'complete'; source: 'gemini' | 'local'; intake: IntakeChatConclusion };

  function fallbackChatConclusion(complaint: string, answers: IntakeChatAnswer[]): IntakeChatConclusion {
    const text = `${complaint} ${answers.map((entry) => `${entry.question} ${entry.answer}`).join(' ')}`.toLowerCase();
    const emergencyPattern = /chest pain|heart attack|c(an't|annot) breathe|short(ness)? of breath|unconscious|passed out|faint(ed)?|severe bleed|heavy bleed|vomit(ing)? blood|stroke|seizure|overdose|suicidal|allergic reaction|swollen face|blue lips/;
    const urgentPattern = /blood|pee|urinat|burning|fever|worsening|severe|c(an't|annot) walk|dizzy|vomit|persistent|infection|pain/;
    const urgency: QuestionnaireUrgency = emergencyPattern.test(text) ? 'emergency' : urgentPattern.test(text) ? 'urgent' : 'priority';
    const urinaryPattern = /pee|urinat|bladder|kidney|urine/;
    const department = urgency === 'emergency' ? 'Emergency Department' : urinaryPattern.test(text) ? 'Urology' : 'General consultation';
    return {
      pathwayId: 'chat-intake',
      pathwayName: 'Chat intake assessment',
      summary: answers.length > 0 ? `${complaint} (assessed from the chat conversation)` : `${complaint} (assessed from your message — the AI assistant was briefly unavailable)`,
      department,
      urgency,
      redFlags: [],
    };
  }

  function normalizeIntakeChatTurn(value: unknown, complaint: string, answers: IntakeChatAnswer[], forceComplete: boolean): IntakeChatTurn {
    const object = asObject(value);
    if (!object) throw new Error('Gemini intake chat response was invalid');
    if (object.action === 'question' && !forceComplete) {
      const questionObject = asObject(object.question);
      const text = boundedText(questionObject?.text, '', 240);
      const type = questionObject?.type;
      if (!text || (type !== 'yes_no' && type !== 'single' && type !== 'scale' && type !== 'text')) throw new Error('Gemini intake chat response was invalid');
      const rawOptions = Array.isArray(questionObject?.options) ? questionObject.options : [];
      const options = rawOptions.flatMap((option) => {
        const optionObject = asObject(option);
        const optionId = boundedText(optionObject?.id, '', 40).replace(/[^a-z0-9_-]/gi, '_');
        const label = boundedText(optionObject?.label, '', 80);
        return optionId && label ? [{ id: optionId, label }] : [];
      });
      if (type === 'single' && options.length < 2) throw new Error('Gemini intake chat response was invalid');
      const id = boundedText(questionObject?.id, '', 40).replace(/[^a-z0-9_-]/gi, '_') || `q${answers.length + 1}`;
      return { action: 'question', question: { id, text, type, ...(type === 'single' ? { options } : {}) } };
    }
    if (object.action === 'complete' || (object.action === 'question' && forceComplete)) {
      const intakeObject = asObject(object.intake) ?? {};
      const local = fallbackChatConclusion(complaint, answers);
      const urgency: QuestionnaireUrgency = intakeObject.urgency === 'emergency' || intakeObject.urgency === 'urgent' || intakeObject.urgency === 'priority' || intakeObject.urgency === 'routine'
        ? intakeObject.urgency
        : local.urgency;
      const redFlags = (Array.isArray(intakeObject.redFlags) ? intakeObject.redFlags : []).flatMap((flag) => {
        const text = boundedText(flag, '', 80);
        return text ? [text] : [];
      }).slice(0, 6);
      return {
        action: 'complete',
        source: 'gemini',
        intake: {
          pathwayId: boundedText(intakeObject.pathwayId, local.pathwayId, 80),
          pathwayName: boundedText(intakeObject.pathwayName, local.pathwayName, 120),
          summary: boundedText(intakeObject.summary, local.summary, 260),
          department: boundedText(intakeObject.department, local.department, 120),
          urgency,
          redFlags,
        },
      };
    }
    throw new Error('Gemini intake chat response was invalid');
  }

  function buildIntakeChatPrompt(complaint: string, answers: IntakeChatAnswer[], forceComplete: boolean): string {
    const lines = [`Patient: ${complaint}`];
    answers.forEach((entry) => {
      lines.push(`Assistant: ${entry.question}`);
      lines.push(`Patient: ${entry.answer}`);
    });
    return `You are a triage intake assistant in a South African public hospital patient portal. Your goal is the FEWEST questions possible — no more than 4 in total — but you MUST ask at least 2 questions before responding with action "complete", unless the patient clearly reported emergency warning signs or the case is obviously minor. Vague or common complaints (pain, fever, headache, urinary symptoms, nausea, dizziness, rash) always need 2-3 questions covering severity, duration, and key warning signs. Ask one short, plain-language question at a time; prefer questions answerable with Yes/No or by picking one of 2-4 options.

Conversation so far:
${lines.join('\n')}
${forceComplete ? '\nYou have asked enough questions. You MUST respond with action "complete" now.\n' : ''}
Return only JSON, exactly one of:
{"action":"question","question":{"id":"short_snake_case_id","text":"the question","type":"yes_no"}} — type must be yes_no, single, scale, or text. For "single" include "options":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}] with 2 to 4 choices. For "scale" the patient rates 0-10.
{"action":"complete","intake":{"pathwayId":"short-id","pathwayName":"short pathway title","summary":"one sentence of what the patient reported","department":"best matching hospital service name","urgency":"emergency|urgent|priority|routine","redFlags":["warning signs if any"]}}

Never diagnose, prescribe, or give treatment advice. If the patient reports emergency warning signs — chest pain, trouble breathing, severe bleeding, fainting, signs of stroke, severe allergic reaction — reply with action "complete" and urgency "emergency" immediately. Choose urgency conservatively.`;
  }

  async function buildIntakeChatTurn(complaint: string, answers: IntakeChatAnswer[]): Promise<IntakeChatTurn> {
    const local: IntakeChatTurn = { action: 'complete', source: 'local', intake: fallbackChatConclusion(complaint, answers) };
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return local;
    if (Date.now() < geminiQuestionnaireCooldownUntil) return local;
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
    url.searchParams.set('key', apiKey);
    const forceComplete = answers.length >= intakeChatMaxTurns;
    const prompt = buildIntakeChatPrompt(complaint, answers, forceComplete);
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } });
    let text: string | undefined;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2 && text === undefined; attempt += 1) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const payload: unknown = await response.json();
        if (!response.ok) {
          lastError = new Error(`Gemini intake chat request failed: ${response.status}`);
          if (response.status !== 429 && response.status < 500) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        const extracted = geminiText(payload);
        if (!extracted) throw new Error('Gemini intake chat response was empty');
        text = extracted;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    if (text === undefined) {
      geminiQuestionnaireCooldownUntil = Date.now() + geminiQuestionnaireCooldownMs;
      console.error('[intake-chat] Gemini unavailable, concluding locally:', lastError?.message ?? lastError);
      return local;
    }
    return normalizeIntakeChatTurn(parseGeminiJson(text), complaint, answers, forceComplete);
  }

  app.post('/api/v1/intake/chat', requireAuth, async (req, res, next) => {
    try {
      const body = asObject(req.body);
      const complaint = boundedText(body?.complaint, '', 300);
      if (complaint.trim().length < 4) {
        res.status(400).json({ error: { code: 'INVALID_INTAKE_CHAT', message: 'Describe your main symptom in 4 to 300 characters.' } });
        return;
      }
      const rawAnswers = Array.isArray(body?.answers) ? body.answers.slice(0, intakeChatMaxTurns + 1) : [];
      const answers: IntakeChatAnswer[] = rawAnswers.flatMap((entry) => {
        const entryObject = asObject(entry);
        const question = boundedText(entryObject?.question, '', 300);
        const answer = boundedText(entryObject?.answer, '', 300);
        return question && answer ? [{ question, answer }] : [];
      });
      const turn = await buildIntakeChatTurn(complaint.trim(), answers);
      res.json({ data: turn });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/translate', async (req, res, next) => {
    try {
      const { texts, target } = req.body as { texts?: unknown; target?: unknown };
      if (!Array.isArray(texts) || texts.length === 0 || texts.length > 60 || typeof target !== 'string' || !(target in translationLanguageNames)) {
        res.status(400).json({ error: { code: 'INVALID_TRANSLATION_REQUEST', message: 'Provide 1 to 60 texts and a supported target language.' } });
        return;
      }
      const requested = texts.map((text) => (typeof text === 'string' ? text.slice(0, 500) : ''));
      if (target === 'en') {
        res.json({ data: { translations: requested } });
        return;
      }
      const translations: string[] = new Array(requested.length);
      const missing: string[] = [];
      const missingIndexes: number[] = [];
      requested.forEach((text, index) => {
        const cached = translationCache.get(`${target}:${text}`);
        if (cached !== undefined) {
          translations[index] = cached;
        } else {
          missing.push(text);
          missingIndexes.push(index);
        }
      });
      if (missing.length > 0) {
        const translated = await translateTexts(missing, target);
        missing.forEach((text, index) => {
          translationCache.set(`${target}:${text}`, translated[index]);
          translations[missingIndexes[index]] = translated[index];
        });
      }
      res.json({ data: { translations } });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Translation')) {
        console.error('[translate] failure:', error.message);
        res.status(502).json({ error: { code: 'TRANSLATION_UNAVAILABLE', message: 'The translation service is unavailable. Please try again shortly.' } });
        return;
      }
      next(error);
    }
  });

  app.post('/api/v1/overseer/administrators', requireAuth, async (req, res, next) => {
    try {
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const operator = await getPool().query('SELECT 1 FROM platform_operators WHERE user_id = $1', [user.id]);
      if (!operator.rowCount) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Platform overseer access is required.' } }); return; }
      const { hospitalId, email } = req.body as { hospitalId?: unknown; email?: unknown };
      if (typeof hospitalId !== 'string' || typeof email !== 'string' || !email.includes('@')) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Choose a hospital and valid administrator email.' } }); return; }
      const hospital = await getPool().query<{ name: string }>('SELECT name FROM hospitals WHERE id = $1 AND active', [hospitalId]);
      if (!hospital.rowCount) { res.status(404).json({ error: { code: 'HOSPITAL_NOT_FOUND', message: 'That hospital is not available.' } }); return; }
      const { claimUrl } = await createAndSendInvitation({ hospitalId, hospitalName: hospital.rows[0]!.name, email, role: 'administrator', invitedBy: user.id, baseUrl: resolveBaseUrl(req) });
      res.status(201).json({ data: { message: 'Administrator invitation email sent. It expires in 72 hours.', claimUrl } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/overseer/hospitals/:id/access', requireAuth, async (req, res, next) => {
    try {
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const operator = await getPool().query('SELECT 1 FROM platform_operators WHERE user_id = $1', [user.id]);
      if (!operator.rowCount) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Platform overseer access is required.' } }); return; }
      const hospital = await getPool().query('SELECT 1 FROM hospitals WHERE id = $1 AND active', [req.params.id]);
      if (!hospital.rowCount) { res.status(404).json({ error: { code: 'HOSPITAL_NOT_FOUND', message: 'That hospital is not available.' } }); return; }
      const administrators = await getPool().query<{ email: string | null; display_name: string | null; created_at: string }>(
        `SELECT u.email, u.display_name, hm.created_at
         FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id
         WHERE hm.hospital_id = $1 AND hm.role = 'administrator' AND hm.active
         ORDER BY hm.created_at`,
        [req.params.id],
      );
      const invitations = await getPool().query<{ email: string; expires_at: string; sent_at: string | null }>(
        `SELECT email, expires_at, sent_at
         FROM staff_invitations
         WHERE hospital_id = $1 AND role = 'administrator' AND claimed_at IS NULL
         ORDER BY created_at DESC`,
        [req.params.id],
      );
      res.json({
        data: {
          administrators: administrators.rows.map((row) => ({ email: row.email, displayName: row.display_name, since: row.created_at })),
          pendingInvitations: invitations.rows.map((row) => ({ email: row.email, expiresAt: row.expires_at, sentAt: row.sent_at })),
        },
      });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/staff', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const membership = req.membership!;
      const { email, role, departmentIds: departmentIdsRaw } = req.body as { email?: unknown; role?: unknown; departmentIds?: unknown };
      if (typeof email !== 'string' || !email.includes('@') || (role !== 'administrator' && role !== 'nurse' && role !== 'doctor' && role !== 'dispatcher')) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Choose a valid team role and email.' } }); return; }
      const departmentIds = departmentIdsRaw === undefined ? [] : normalizeUuidList(departmentIdsRaw);
      if (!departmentIds) { res.status(400).json({ error: { code: 'INVALID_DEPARTMENTS', message: 'Choose up to 20 departments from your hospital.' } }); return; }
      if (role === 'dispatcher' && departmentIds.length > 0) { res.status(400).json({ error: { code: 'INVALID_DEPARTMENTS', message: 'Dispatchers are not assigned clinical departments.' } }); return; }
      if (departmentIds.length > 0) {
        const owned = await getPool().query<{ id: string }>(
          'SELECT id FROM departments WHERE hospital_id = $1 AND active AND id = ANY($2::uuid[])',
          [membership.hospitalId, departmentIds],
        );
        if (owned.rowCount !== departmentIds.length) { res.status(400).json({ error: { code: 'INVALID_DEPARTMENTS', message: 'Choose departments from your hospital.' } }); return; }
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const { claimUrl, emailSent } = await createAndSendInvitation({ hospitalId: membership.hospitalId, hospitalName: membership.hospitalName, email, role, invitedBy: user.id, baseUrl: resolveBaseUrl(req), departmentIds });
      await recordAudit({
        actorUserId: user.id,
        hospitalId: membership.hospitalId,
        entityType: 'staff_invitation',
        action: 'staff_invitation.created',
        metadata: { email: email.trim().toLowerCase(), role, departmentIds },
      });
      const roleLabel = role === 'administrator' ? 'Administrator' : role === 'nurse' ? 'Staff' : role === 'doctor' ? 'Doctor' : 'Dispatcher';
      const message = emailSent
        ? `${roleLabel} invitation email sent. It expires in 72 hours.`
        : `Invitation created for ${roleLabel.toLowerCase()} — email delivery is unavailable, share the link below. It expires in 72 hours.`;
      res.status(201).json({ data: { message, claimUrl, emailSent } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/staff', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospital = req.membership!;
      const members = await getPool().query<{ membership_id: string; email: string | null; display_name: string | null; role: 'administrator' | 'nurse' | 'doctor' | 'dispatcher'; active: boolean; created_at: string; departments: { id: string; name: string }[] }>(
        `SELECT hm.id AS membership_id, u.email, u.display_name, hm.role, hm.active, hm.created_at,
                COALESCE((
                  SELECT json_agg(json_build_object('id', d.id, 'name', d.name) ORDER BY d.name)
                  FROM membership_departments md
                  JOIN departments d ON d.id = md.department_id
                  WHERE md.membership_id = hm.id
                ), '[]'::json) AS departments
         FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id
         WHERE hm.hospital_id = $1
         ORDER BY hm.active DESC, hm.created_at`,
        [hospital.hospitalId],
      );
      const invitations = await getPool().query<{ email: string; role: 'administrator' | 'nurse' | 'doctor' | 'dispatcher'; department_ids: string[]; expires_at: string; sent_at: string | null }>(
        `SELECT email, role, department_ids, expires_at, sent_at
         FROM staff_invitations
         WHERE hospital_id = $1 AND claimed_at IS NULL
         ORDER BY created_at DESC`,
        [hospital.hospitalId],
      );
      const display = await getPool().query<{ display_token: string | null; display_active: boolean }>(
        'SELECT display_token, display_active FROM hospitals WHERE id = $1',
        [hospital.hospitalId],
      );
      res.json({
        data: {
          hospitalId: hospital.hospitalId,
          hospitalName: hospital.hospitalName,
          displayPath: display.rows[0]?.display_active && display.rows[0]?.display_token ? `/display/${display.rows[0].display_token}` : null,
          members: members.rows.map((row) => ({ membershipId: row.membership_id, email: row.email, displayName: row.display_name, role: row.role, active: row.active, since: row.created_at, departments: row.departments })),
          pendingInvitations: invitations.rows.map((row) => ({ email: row.email, role: row.role, departmentIds: row.department_ids, expiresAt: row.expires_at, sentAt: row.sent_at })),
        },
      });
    } catch (error) { next(error); }
  });

  app.patch('/api/v1/admin/staff/:membershipId', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const membershipId = String(req.params.membershipId);
      if (!uuidPattern.test(membershipId)) { res.status(404).json({ error: { code: 'MEMBERSHIP_NOT_FOUND', message: 'That team member was not found.' } }); return; }
      const { role, active, departmentIds: departmentIdsRaw } = req.body as { role?: unknown; active?: unknown; departmentIds?: unknown };
      if (role === undefined && active === undefined && departmentIdsRaw === undefined) {
        res.status(400).json({ error: { code: 'INVALID_MEMBERSHIP_UPDATE', message: 'Provide a role, active state, or department assignment to change.' } });
        return;
      }
      if (role !== undefined && role !== 'administrator' && role !== 'nurse' && role !== 'doctor' && role !== 'dispatcher') {
        res.status(400).json({ error: { code: 'INVALID_MEMBERSHIP_UPDATE', message: 'Choose a valid team role.' } });
        return;
      }
      if (active !== undefined && typeof active !== 'boolean') {
        res.status(400).json({ error: { code: 'INVALID_MEMBERSHIP_UPDATE', message: 'The active state must be true or false.' } });
        return;
      }
      const departmentIds = departmentIdsRaw === undefined ? undefined : normalizeUuidList(departmentIdsRaw);
      if (!departmentIds) {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENTS', message: 'Choose up to 20 departments from your hospital.' } });
        return;
      }
      const actor = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const target = await getPool().query<{ user_id: string; role: 'administrator' | 'nurse' | 'doctor' | 'dispatcher'; active: boolean }>(
        'SELECT user_id, role, active FROM hospital_memberships WHERE id = $1 AND hospital_id = $2',
        [membershipId, hospitalId],
      );
      const current = target.rows[0];
      if (!current) { res.status(404).json({ error: { code: 'MEMBERSHIP_NOT_FOUND', message: 'That team member was not found.' } }); return; }
      if (current.user_id === actor.id) {
        res.status(409).json({ error: { code: 'SELF_CHANGE', message: 'You cannot change your own hospital access. Ask another administrator.' } });
        return;
      }
      const nextRole = (role ?? current.role) as 'administrator' | 'nurse' | 'doctor' | 'dispatcher';
      const nextActive = (active ?? current.active) as boolean;
      if (current.role === 'administrator' && current.active && (nextRole !== 'administrator' || !nextActive)) {
        const admins = await getPool().query<{ count: string }>(
          "SELECT count(*) AS count FROM hospital_memberships WHERE hospital_id = $1 AND role = 'administrator' AND active AND id <> $2",
          [hospitalId, membershipId],
        );
        if (Number(admins.rows[0]!.count) === 0) {
          res.status(409).json({ error: { code: 'LAST_ADMINISTRATOR', message: 'At least one active administrator must remain. Promote another administrator first.' } });
          return;
        }
      }
      if (departmentIds && departmentIds.length > 0) {
        const owned = await getPool().query<{ id: string }>(
          'SELECT id FROM departments WHERE hospital_id = $1 AND id = ANY($2::uuid[])',
          [hospitalId, departmentIds],
        );
        if (owned.rowCount !== departmentIds.length) { res.status(400).json({ error: { code: 'INVALID_DEPARTMENTS', message: 'Choose departments from your hospital.' } }); return; }
      }

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE hospital_memberships SET role = $3, active = $4 WHERE id = $1 AND hospital_id = $2',
          [membershipId, hospitalId, nextRole, nextActive],
        );
        if (nextRole === 'administrator' || nextRole === 'dispatcher') {
          await client.query('DELETE FROM membership_departments WHERE membership_id = $1', [membershipId]);
        } else if (departmentIds) {
          await client.query('DELETE FROM membership_departments WHERE membership_id = $1', [membershipId]);
          if (departmentIds.length > 0) {
            await client.query(
              `INSERT INTO membership_departments (membership_id, department_id)
               SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
              [membershipId, departmentIds],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      await recordAudit({
        actorUserId: actor.id,
        hospitalId,
        entityType: 'hospital_membership',
        entityId: membershipId,
        action: 'hospital_membership.updated',
        metadata: {
          role: { from: current.role, to: nextRole },
          active: { from: current.active, to: nextActive },
          ...(departmentIds && nextRole !== 'administrator' ? { departmentIds } : {}),
        },
      });
      res.json({ data: { membershipId, role: nextRole, active: nextActive } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/departments', requireAuth, async (req, res, next) => {
    try {
      const membership = await loadMembership(req.auth!.subject);
      if (!membership) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required.' } }); return; }
      const departments = await getPool().query<{ id: string; name: string; average_consultation_minutes: number }>(
        'SELECT id, name, average_consultation_minutes FROM departments WHERE hospital_id = $1 AND active ORDER BY name',
        [membership.hospitalId],
      );
      res.json({
        data: {
          hospitalId: membership.hospitalId,
          hospitalName: membership.hospitalName,
          departments: departments.rows.map((row) => ({ id: row.id, name: row.name, averageConsultationMinutes: row.average_consultation_minutes })),
        },
      });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/departments', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const departments = await getPool().query<{ id: string; name: string; average_consultation_minutes: number; active: boolean; slot_count: string; appointment_count: string }>(
        `SELECT d.id, d.name, d.average_consultation_minutes, d.active,
                COALESCE(s.slot_count, 0) AS slot_count,
                COALESCE(a.appointment_count, 0) AS appointment_count
         FROM departments d
         LEFT JOIN (
           SELECT department_id, count(*) AS slot_count
           FROM appointment_slots WHERE hospital_id = $1 GROUP BY department_id
         ) s ON s.department_id = d.id
         LEFT JOIN (
           SELECT hospital_service_id AS department_id, count(*) AS appointment_count
           FROM appointments WHERE hospital_id = $1 GROUP BY department_id
         ) a ON a.department_id = d.id
         WHERE d.hospital_id = $1
         ORDER BY d.active DESC, d.name`,
        [hospitalId],
      );
      res.json({
        data: departments.rows.map((row) => ({
          id: row.id,
          name: row.name,
          averageConsultationMinutes: Number(row.average_consultation_minutes),
          active: row.active,
          slotCount: Number(row.slot_count),
          appointmentCount: Number(row.appointment_count),
        })),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/departments', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const membership = req.membership!;
      const { name, averageConsultationMinutes } = req.body as { name?: unknown; averageConsultationMinutes?: unknown };
      const trimmedName = boundedText(name, '', 80);
      const validMinutes = typeof averageConsultationMinutes === 'number' && Number.isInteger(averageConsultationMinutes) && averageConsultationMinutes >= 5 && averageConsultationMinutes <= 240;
      if (trimmedName.length < 2 || !validMinutes) {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENT', message: 'Enter a department name of at least 2 characters and an average consultation time of 5 to 240 minutes.' } });
        return;
      }
      const duplicate = await getPool().query('SELECT 1 FROM departments WHERE hospital_id = $1 AND lower(name) = lower($2)', [membership.hospitalId, trimmedName]);
      if (duplicate.rowCount) { res.status(409).json({ error: { code: 'DEPARTMENT_EXISTS', message: 'A department with that name already exists at your hospital.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      let created;
      try {
        created = await getPool().query<{ id: string }>(
          'INSERT INTO departments (hospital_id, name, average_consultation_minutes) VALUES ($1, $2, $3) RETURNING id',
          [membership.hospitalId, trimmedName, averageConsultationMinutes],
        );
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          res.status(409).json({ error: { code: 'DEPARTMENT_EXISTS', message: 'A department with that name already exists at your hospital.' } });
          return;
        }
        throw error;
      }
      await recordAudit({
        actorUserId: user.id,
        hospitalId: membership.hospitalId,
        entityType: 'department',
        entityId: created.rows[0]!.id,
        action: 'department.created',
        metadata: { name: trimmedName, averageConsultationMinutes },
      });
      res.status(201).json({ data: { id: created.rows[0]!.id, name: trimmedName, averageConsultationMinutes, active: true, slotCount: 0, appointmentCount: 0 } });
    } catch (error) { next(error); }
  });

  app.patch('/api/v1/admin/departments/:id', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const departmentId = String(req.params.id);
      if (!uuidPattern.test(departmentId)) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department was not found.' } }); return; }
      const { name, averageConsultationMinutes, active } = req.body as { name?: unknown; averageConsultationMinutes?: unknown; active?: unknown };
      if (name === undefined && averageConsultationMinutes === undefined && active === undefined) {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENT', message: 'Provide a name, average consultation time, or active state to change.' } });
        return;
      }
      const current = await getPool().query<{ name: string; active: boolean }>(
        'SELECT name, active FROM departments WHERE id = $1 AND hospital_id = $2',
        [departmentId, hospitalId],
      );
      if (!current.rowCount) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department was not found.' } }); return; }
      const trimmedName = name === undefined ? current.rows[0]!.name : boundedText(name, '', 80);
      if (trimmedName.length < 2) {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENT', message: 'Enter a department name of at least 2 characters.' } });
        return;
      }
      const nextMinutes = averageConsultationMinutes === undefined
        ? undefined
        : (typeof averageConsultationMinutes === 'number' && Number.isInteger(averageConsultationMinutes) && averageConsultationMinutes >= 5 && averageConsultationMinutes <= 240 ? averageConsultationMinutes : null);
      if (averageConsultationMinutes !== undefined && nextMinutes === null) {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENT', message: 'The average consultation time must be 5 to 240 minutes.' } });
        return;
      }
      if (active !== undefined && typeof active !== 'boolean') {
        res.status(400).json({ error: { code: 'INVALID_DEPARTMENT', message: 'The active state must be true or false.' } });
        return;
      }
      if (name !== undefined) {
        const duplicate = await getPool().query('SELECT 1 FROM departments WHERE hospital_id = $1 AND lower(name) = lower($2) AND id <> $3', [hospitalId, trimmedName, departmentId]);
        if (duplicate.rowCount) { res.status(409).json({ error: { code: 'DEPARTMENT_EXISTS', message: 'A department with that name already exists at your hospital.' } }); return; }
      }
      const updated = await getPool().query<{ name: string; average_consultation_minutes: number; active: boolean }>(
        `UPDATE departments SET name = $3, average_consultation_minutes = COALESCE($4, average_consultation_minutes), active = COALESCE($5, active)
         WHERE id = $1 AND hospital_id = $2
         RETURNING name, average_consultation_minutes, active`,
        [departmentId, hospitalId, trimmedName, nextMinutes, active ?? null],
      );
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const row = updated.rows[0]!;
      await recordAudit({
        actorUserId: user.id,
        hospitalId,
        entityType: 'department',
        entityId: departmentId,
        action: 'department.updated',
        metadata: { name: row.name, averageConsultationMinutes: Number(row.average_consultation_minutes), active: row.active },
      });
      res.json({ data: { id: departmentId, name: row.name, averageConsultationMinutes: Number(row.average_consultation_minutes), active: row.active } });
    } catch (error) { next(error); }
  });

  app.delete('/api/v1/admin/departments/:id', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const departmentId = String(req.params.id);
      if (!uuidPattern.test(departmentId)) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department was not found.' } }); return; }
      const department = await getPool().query<{ name: string }>('SELECT name FROM departments WHERE id = $1 AND hospital_id = $2', [departmentId, hospitalId]);
      if (!department.rowCount) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department was not found.' } }); return; }
      const usage = await getPool().query<{ slots: string; appointments: string }>(
        `SELECT (SELECT count(*) FROM appointment_slots WHERE department_id = $1) AS slots,
                (SELECT count(*) FROM appointments WHERE hospital_service_id = $1) AS appointments`,
        [departmentId],
      );
      const slots = Number(usage.rows[0]!.slots);
      const appointments = Number(usage.rows[0]!.appointments);
      if (slots > 0 || appointments > 0) {
        res.status(409).json({
          error: {
            code: 'DEPARTMENT_IN_USE',
            message: `This department has ${slots} published slot${slots === 1 ? '' : 's'} and ${appointments} booking${appointments === 1 ? '' : 's'}. Deactivate it instead of removing it.`,
          },
        });
        return;
      }
      await getPool().query('DELETE FROM departments WHERE id = $1 AND hospital_id = $2', [departmentId, hospitalId]);
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await recordAudit({
        actorUserId: user.id,
        hospitalId,
        entityType: 'department',
        entityId: departmentId,
        action: 'department.deleted',
        metadata: { name: department.rows[0]!.name },
      });
      res.status(204).send();
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/display', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const result = await getPool().query<{ display_token: string | null; display_active: boolean }>(
        'SELECT display_token, display_active FROM hospitals WHERE id = $1',
        [req.hospitalId!],
      );
      const row = result.rows[0];
      res.json({ data: { token: row?.display_token ?? null, active: row?.display_active ?? false } });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/display/rotate', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const token = randomBytes(24).toString('base64url');
      await getPool().query('UPDATE hospitals SET display_token = $2, display_active = true WHERE id = $1', [hospitalId, token]);
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      // Never put the kiosk token in audit metadata — it is a shared secret.
      await recordAudit({ actorUserId: user.id, hospitalId, entityType: 'hospital', entityId: hospitalId, action: 'hospital_display.rotated', metadata: { active: true } });
      res.json({ data: { token, active: true } });
    } catch (error) { next(error); }
  });

  app.patch('/api/v1/admin/display', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const { active } = req.body as { active?: unknown };
      if (typeof active !== 'boolean') { res.status(400).json({ error: { code: 'INVALID_DISPLAY_SETTING', message: 'The display state must be true or false.' } }); return; }
      const updated = await getPool().query<{ display_active: boolean }>(
        'UPDATE hospitals SET display_active = $2 WHERE id = $1 AND display_token IS NOT NULL RETURNING display_active',
        [hospitalId, active],
      );
      if (!updated.rowCount) { res.status(400).json({ error: { code: 'NO_DISPLAY_TOKEN', message: 'Generate a display link first.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await recordAudit({
        actorUserId: user.id,
        hospitalId,
        entityType: 'hospital',
        entityId: hospitalId,
        action: active ? 'hospital_display.activated' : 'hospital_display.deactivated',
        metadata: {},
      });
      res.json({ data: { active: updated.rows[0]!.display_active } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/audit', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
      const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;
      const events = await getPool().query<{ id: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string; display_name: string | null; email: string | null }>(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
                u.display_name, u.email
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.hospital_id = $1
         ORDER BY a.created_at DESC
         LIMIT $2`,
        [req.hospitalId!, limit],
      );
      res.json({
        data: events.rows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
          createdAt: row.created_at,
          actor: row.display_name || row.email ? { displayName: row.display_name, email: row.email } : null,
        })),
      });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/overview', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const [departments, appointments, queue, team] = await Promise.all([
        getPool().query<{ id: string; name: string; average_consultation_minutes: number; slot_count: string; capacity: string; reserved: string }>(
          `SELECT d.id, d.name, d.average_consultation_minutes,
                  COALESCE(s.slot_count, 0) AS slot_count, COALESCE(s.capacity, 0) AS capacity, COALESCE(s.reserved, 0) AS reserved
           FROM departments d
           LEFT JOIN (
             SELECT department_id, count(*) AS slot_count, sum(capacity) AS capacity, sum(reserved_count) AS reserved
             FROM appointment_slots WHERE hospital_id = $1 AND slot_date = CURRENT_DATE GROUP BY department_id
           ) s ON s.department_id = d.id
           WHERE d.hospital_id = $1 AND d.active
           ORDER BY d.name`,
          [hospitalId],
        ),
        getPool().query<{ department_id: string; booked: string; cancelled: string }>(
          `SELECT hospital_service_id AS department_id,
                  count(*) FILTER (WHERE status = 'booked') AS booked,
                  count(*) FILTER (WHERE status = 'cancelled') AS cancelled
           FROM appointments WHERE hospital_id = $1 AND appointment_date = CURRENT_DATE
           GROUP BY 1`,
          [hospitalId],
        ),
        getPool().query<{ department_id: string; waiting: string; called: string }>(
          `SELECT hospital_service_id AS department_id,
                  count(*) FILTER (WHERE status = 'waiting') AS waiting,
                  count(*) FILTER (WHERE status = 'called') AS called
           FROM queue_entries WHERE hospital_id = $1 AND queue_date = CURRENT_DATE
           GROUP BY 1`,
          [hospitalId],
        ),
        getPool().query<{ active_members: string; pending_invitations: string; today: string }>(
          `SELECT (SELECT count(*) FROM hospital_memberships WHERE hospital_id = $1 AND active) AS active_members,
                  (SELECT count(*) FROM staff_invitations WHERE hospital_id = $1 AND claimed_at IS NULL AND expires_at > now()) AS pending_invitations,
                  to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`,
          [hospitalId],
        ),
      ]);
      const appointmentsByDepartment = new Map(appointments.rows.map((row) => [row.department_id, row]));
      const queueByDepartment = new Map(queue.rows.map((row) => [row.department_id, row]));
      const rows = departments.rows.map((row) => {
        const appointmentRow = appointmentsByDepartment.get(row.id);
        const queueRow = queueByDepartment.get(row.id);
        return {
          id: row.id,
          name: row.name,
          averageConsultationMinutes: Number(row.average_consultation_minutes),
          slotsToday: Number(row.slot_count),
          capacityToday: Number(row.capacity),
          reservedToday: Number(row.reserved),
          appointmentsBooked: Number(appointmentRow?.booked ?? 0),
          appointmentsCancelled: Number(appointmentRow?.cancelled ?? 0),
          queueWaiting: Number(queueRow?.waiting ?? 0),
          queueCalled: Number(queueRow?.called ?? 0),
        };
      });
      const teamRow = team.rows[0]!;
      res.json({
        data: {
          date: teamRow.today,
          totals: {
            slotsToday: rows.reduce((total, row) => total + row.slotsToday, 0),
            capacityToday: rows.reduce((total, row) => total + row.capacityToday, 0),
            reservedToday: rows.reduce((total, row) => total + row.reservedToday, 0),
            appointmentsBooked: rows.reduce((total, row) => total + row.appointmentsBooked, 0),
            appointmentsCancelled: rows.reduce((total, row) => total + row.appointmentsCancelled, 0),
            queueWaiting: rows.reduce((total, row) => total + row.queueWaiting, 0),
            queueCalled: rows.reduce((total, row) => total + row.queueCalled, 0),
            activeMembers: Number(teamRow.active_members),
            pendingInvitations: Number(teamRow.pending_invitations),
          },
          departments: rows,
        },
      });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/slots', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId ? req.query.departmentId : null;
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: { code: 'INVALID_DATE', message: 'Choose a valid date.' } }); return; }
      if (departmentId) {
        const owned = await getPool().query('SELECT 1 FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [departmentId, hospitalId]);
        if (!owned.rowCount) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department is not available at your hospital.' } }); return; }
      }
      const slots = await getPool().query<{ id: string; department_id: string; department_name: string; slot_date: string; start_time: string; end_time: string; capacity: number; reserved_count: number }>(
        `SELECT s.id, s.department_id, d.name AS department_name, to_char(s.slot_date, 'YYYY-MM-DD') AS slot_date,
                s.start_time, s.end_time, s.capacity, s.reserved_count
         FROM appointment_slots s
         JOIN departments d ON d.id = s.department_id
         WHERE s.hospital_id = $1 AND ($2::uuid IS NULL OR s.department_id = $2) AND ($3::date IS NULL OR s.slot_date = $3)
         ORDER BY s.slot_date, s.start_time
         LIMIT 500`,
        [hospitalId, departmentId, date],
      );
      res.json({
        data: slots.rows.map((row) => ({
          id: row.id,
          departmentId: row.department_id,
          departmentName: row.department_name,
          date: sqlDateOnly(row.slot_date),
          startTime: row.start_time.slice(0, 5),
          endTime: row.end_time.slice(0, 5),
          capacity: Number(row.capacity),
          reservedCount: Number(row.reserved_count),
        })),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/slots', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const membership = req.membership!;
      const { departmentId, date, startTime, endTime, slotMinutes, capacity } = req.body as {
        departmentId?: unknown; date?: unknown; startTime?: unknown; endTime?: unknown; slotMinutes?: unknown; capacity?: unknown;
      };
      const start = parseClock(startTime);
      const end = parseClock(endTime);
      const today = new Date().toISOString().slice(0, 10);
      const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
      const validLength = typeof slotMinutes === 'number' && Number.isInteger(slotMinutes) && slotMinutes >= 5 && slotMinutes <= 240;
      const validCapacity = typeof capacity === 'number' && Number.isInteger(capacity) && capacity >= 1 && capacity <= 50;
      if (typeof departmentId !== 'string' || !validDate || start === undefined || end === undefined
        || end <= start || start < 7 * 60 || end > 19 * 60 || !validLength || !validCapacity) {
        res.status(400).json({ error: { code: 'INVALID_SLOT', message: 'Choose a department, a future date, a window between 07:00 and 19:00, a slot length of 5 to 240 minutes, and a capacity of 1 to 50.' } });
        return;
      }
      const department = await getPool().query<{ name: string }>('SELECT name FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [departmentId, membership.hospitalId]);
      if (!department.rowCount) { res.status(404).json({ error: { code: 'DEPARTMENT_NOT_FOUND', message: 'That department is not available at your hospital.' } }); return; }
      const slotStarts: number[] = [];
      for (let cursor = start; cursor + slotMinutes! <= end; cursor += slotMinutes!) slotStarts.push(cursor);
      if (slotStarts.length === 0) { res.status(400).json({ error: { code: 'INVALID_SLOT', message: 'The slot length does not fit inside the chosen time window.' } }); return; }
      if (slotStarts.length > 200) { res.status(400).json({ error: { code: 'INVALID_SLOT', message: 'Create at most 200 slots at a time.' } }); return; }

      const client = await getPool().connect();
      let created = 0;
      try {
        await client.query('BEGIN');
        const clash = await client.query(
          `SELECT 1 FROM appointment_slots
           WHERE department_id = $1 AND slot_date = $2 AND start_time >= $3::time AND start_time < $4::time`,
          [departmentId, date, formatClock(start), formatClock(end)],
        );
        if (clash.rowCount) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: { code: 'SLOTS_EXIST', message: 'Slots already exist for part of that window. Choose a different time window.' } });
          return;
        }
        for (const slotStart of slotStarts) {
          const insert = await client.query(
            `INSERT INTO appointment_slots (hospital_id, department_id, slot_date, start_time, end_time, capacity)
             VALUES ($1, $2, $3, $4::time, $5::time, $6) RETURNING id`,
            [membership.hospitalId, departmentId, date, formatClock(slotStart), formatClock(slotStart + slotMinutes!), capacity],
          );
          created += insert.rowCount ? Number(insert.rowCount) : 0;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const actor = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await recordAudit({
        actorUserId: actor.id,
        hospitalId: membership.hospitalId,
        entityType: 'appointment_slot',
        action: 'appointment_slots.created',
        metadata: { departmentId, departmentName: department.rows[0]!.name, date, created, slotMinutes, capacity },
      });
      res.status(201).json({ data: { created, departmentId, date, departmentName: department.rows[0]!.name } });
    } catch (error) { next(error); }
  });

  app.delete('/api/v1/admin/slots/:id', requireAuth, requireRole('administrator'), requireHospital(), async (req, res, next) => {
    try {
      const hospitalId = req.hospitalId!;
      const slotId = String(req.params.id);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slotId)) {
        res.status(404).json({ error: { code: 'SLOT_NOT_FOUND', message: 'That appointment slot was not found.' } });
        return;
      }
      const slot = await getPool().query<{ department_id: string; slot_date: string; start_time: string }>(
        `SELECT department_id, to_char(slot_date, 'YYYY-MM-DD') AS slot_date, start_time
         FROM appointment_slots WHERE id = $1 AND hospital_id = $2`,
        [slotId, hospitalId],
      );
      if (!slot.rowCount) { res.status(404).json({ error: { code: 'SLOT_NOT_FOUND', message: 'That appointment slot was not found.' } }); return; }
      const target = slot.rows[0]!;
      const booked = await getPool().query(
        `SELECT 1 FROM appointments
         WHERE hospital_service_id = $1 AND appointment_date = $2 AND appointment_time = $3::time AND status = 'booked'`,
        [target.department_id, sqlDateOnly(target.slot_date), target.start_time],
      );
      if (booked.rowCount) { res.status(409).json({ error: { code: 'SLOT_BOOKED', message: 'This slot already has a booking and cannot be removed.' } }); return; }
      await getPool().query('DELETE FROM appointment_slots WHERE id = $1 AND hospital_id = $2', [slotId, hospitalId]);
      const actor = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await recordAudit({
        actorUserId: actor.id,
        hospitalId,
        entityType: 'appointment_slot',
        entityId: slotId,
        action: 'appointment_slots.deleted',
        metadata: { departmentId: target.department_id, date: sqlDateOnly(target.slot_date), startTime: target.start_time.slice(0, 5) },
      });
      res.status(204).send();
    } catch (error) { next(error); }
  });

  app.post('/api/v1/invitations/claim', requireAuth, async (req, res, next) => {
    try {
      const { token } = req.body as { token?: unknown };
      if (typeof token !== 'string' || token.length < 20) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'This invitation link is invalid.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      if (!user.email) { res.status(400).json({ error: { code: 'EMAIL_REQUIRED', message: 'Your sign-in account must have an email address.' } }); return; }
      const claim = await getPool().query<{ hospital_id: string; role: 'administrator' | 'nurse' | 'doctor' | 'dispatcher'; department_ids: string[] }>(
        `UPDATE staff_invitations SET claimed_by = $1, claimed_at = now()
         WHERE token_hash = $2 AND lower(email) = lower($3) AND claimed_at IS NULL AND expires_at > now()
         RETURNING hospital_id, role, department_ids`,
        [user.id, tokenHash(token), user.email],
      );
      const invitation = claim.rows[0];
      if (!invitation) { res.status(400).json({ error: { code: 'INVITATION_UNAVAILABLE', message: 'This invitation is expired, already claimed, or belongs to another email address.' } }); return; }
      const membership = await getPool().query<{ id: string }>(
        `INSERT INTO hospital_memberships (user_id, hospital_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, hospital_id) DO UPDATE SET role = EXCLUDED.role, active = true
         RETURNING id`,
        [user.id, invitation.hospital_id, invitation.role],
      );
      const membershipId = membership.rows[0]!.id;
      // Plan §4: the invited department assignments follow the claim. Administrators
      // and legacy invitations carry no assignments, which means "all specialties".
      await getPool().query('DELETE FROM membership_departments WHERE membership_id = $1', [membershipId]);
      if (invitation.department_ids.length > 0) {
        await getPool().query(
          `INSERT INTO membership_departments (membership_id, department_id)
           SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [membershipId, invitation.department_ids],
        );
      }
      await recordAudit({
        actorUserId: user.id,
        hospitalId: invitation.hospital_id,
        entityType: 'hospital_membership',
        action: 'staff_invitation.claimed',
        metadata: { role: invitation.role, departmentIds: invitation.department_ids },
      });
      res.json({ data: { role: invitation.role, hospitalId: invitation.hospital_id } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/appointments', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{
        id: string; appointment_date: string; appointment_time: string; status: string; hospital_id: string; service_id: string; hospital_name: string; service_name: string; address: string; triage_urgency: QuestionnaireUrgency | null; triage_pathway: string | null; triage_department: string | null; triage_summary: string | null; triage_red_flags: string[];
      }>(
        `SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.hospital_id, a.hospital_service_id AS service_id, h.name AS hospital_name, hs.name AS service_name, h.address,
                a.triage_urgency, a.triage_pathway, a.triage_department, a.triage_summary, a.triage_red_flags
         FROM appointments a
         JOIN users u ON u.id = a.user_id
         JOIN hospitals h ON h.id = a.hospital_id
         JOIN departments hs ON hs.id = a.hospital_service_id
         WHERE u.auth0_subject = $1 AND (a.status IN ('cancelled', 'checked_in') OR (a.status = 'booked' AND a.appointment_date >= CURRENT_DATE))
         ORDER BY a.status, a.appointment_date, a.appointment_time`,
        [req.auth!.subject],
      );
      res.json({ data: result.rows.map((row) => ({ id: row.id, hospitalId: row.hospital_id, serviceId: row.service_id, date: row.appointment_date, time: row.appointment_time.slice(0, 5), status: row.status, hospitalName: row.hospital_name, serviceName: row.service_name, address: row.address, triageSummary: row.triage_urgency && row.triage_pathway && row.triage_department && row.triage_summary ? { urgency: row.triage_urgency, pathwayName: row.triage_pathway, department: row.triage_department, summary: row.triage_summary, redFlags: row.triage_red_flags } : null })) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/appointments', requireAuth, async (req, res, next) => {
    try {
      const { hospitalId, serviceId, date, time, triageSummary: rawTriageSummary } = req.body as { hospitalId?: unknown; serviceId?: unknown; date?: unknown; time?: unknown; triageSummary?: unknown };
      const summary = triageSummary(rawTriageSummary);
      if (typeof hospitalId !== 'string' || typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string' || summary === undefined) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose a hospital, service, date, and time.' } });
        return;
      }
      if (!isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING_TIME', message: 'Bookings are available from 07:00 to 19:00 on future dates.' } });
        return;
      }
      const service = await getPool().query('SELECT 1 FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
      if (!service.rowCount) {
        res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That service is not available at the selected hospital.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const result = await getPool().query<{ id: string }>(
        `INSERT INTO appointments (user_id, hospital_id, hospital_service_id, appointment_date, appointment_time, triage_urgency, triage_pathway, triage_department, triage_summary, triage_red_flags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [user.id, hospitalId, serviceId, date, time, summary?.urgency ?? null, summary?.pathwayName ?? null, summary?.department ?? null, summary?.summary ?? null, summary?.redFlags ?? []],
      );
      res.status(201).json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v1/appointments/:id', requireAuth, async (req, res, next) => {
    try {
      const { serviceId, date, time } = req.body as { serviceId?: unknown; date?: unknown; time?: unknown };
      if (typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string' || !isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose an available service, future date, and time between 07:00 and 19:00.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET hospital_service_id = $1, appointment_date = $2, appointment_time = $3
         FROM users u
         WHERE a.id = $4 AND a.user_id = u.id AND u.auth0_subject = $5 AND a.status = 'booked'
           AND EXISTS (SELECT 1 FROM departments hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
         RETURNING a.id`,
        [serviceId, date, time, req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That active appointment was not found.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/v1/appointments/:id', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET status = 'cancelled'
         FROM users u
         WHERE a.id = $1 AND a.user_id = u.id AND u.auth0_subject = $2 AND a.status = 'booked'
         RETURNING a.id`,
        [req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That active appointment was not found.' } });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/appointments/:id/rebook', requireAuth, async (req, res, next) => {
    try {
      const { serviceId, date, time } = req.body as { serviceId?: unknown; date?: unknown; time?: unknown };
      if (typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string' || !isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose an available service, future date, and time between 07:00 and 19:00.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET hospital_service_id = $1, appointment_date = $2, appointment_time = $3, status = 'booked'
         FROM users u
         WHERE a.id = $4 AND a.user_id = u.id AND u.auth0_subject = $5 AND a.status = 'cancelled'
           AND EXISTS (SELECT 1 FROM departments hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
         RETURNING a.id`,
        [serviceId, date, time, req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That cancelled appointment was not found.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/appointments/:id/check-in', requireAuth, async (req, res, next) => {
    try {
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const found = await getPool().query<{ id: string; status: string; is_today: boolean; hospital_id: string; hospital_service_id: string; triage_urgency: QuestionnaireUrgency | null; triage_pathway: string | null; triage_department: string | null; triage_summary: string | null; triage_red_flags: string[] }>(
        `SELECT id, status, appointment_date = CURRENT_DATE AS is_today, hospital_id, hospital_service_id,
                triage_urgency, triage_pathway, triage_department, triage_summary, triage_red_flags
         FROM appointments WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id],
      );
      const appointment = found.rows[0];
      if (!appointment) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That appointment was not found.' } });
        return;
      }
      if (appointment.status !== 'booked') {
        res.status(409).json({ error: { code: 'ALREADY_CHECKED_IN', message: 'This appointment was already checked in or is no longer active.' } });
        return;
      }
      if (!appointment.is_today) {
        res.status(400).json({ error: { code: 'CHECK_IN_NOT_OPEN', message: 'Check-in opens on the day of your appointment.' } });
        return;
      }
      await getPool().query(`UPDATE appointments SET status = 'checked_in' WHERE id = $1`, [appointment.id]);
      const linked = await getPool().query<{ id: string }>(
        `UPDATE queue_entries SET appointment_id = $1
         WHERE user_id = $2 AND hospital_service_id = $3 AND queue_date = CURRENT_DATE
           AND status = 'awaiting_triage' AND appointment_id IS NULL
         RETURNING id`,
        [appointment.id, user.id, appointment.hospital_service_id],
      );
      if (linked.rowCount) {
        res.status(201).json({ data: { id: linked.rows[0]!.id } });
        return;
      }
      const entry = await getPool().query<{ id: string }>(
        `INSERT INTO queue_entries (user_id, hospital_id, hospital_service_id, appointment_id, status, triage_urgency, triage_pathway, triage_department, triage_summary, triage_red_flags)
         VALUES ($1, $2, $3, $4, 'awaiting_triage', $5, $6, $7, $8, $9) RETURNING id`,
        [user.id, appointment.hospital_id, appointment.hospital_service_id, appointment.id, appointment.triage_urgency, appointment.triage_pathway, appointment.triage_department, appointment.triage_summary, appointment.triage_red_flags],
      );
      res.status(201).json({ data: { id: entry.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/queue', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{
        id: string; status: string; hospital_name: string; service_name: string; address: string; joined_at: string; position: number | null;
        category: QuestionnaireUrgency | null; triage_urgency: QuestionnaireUrgency | null; triage_pathway: string | null; triage_department: string | null; triage_summary: string | null; triage_red_flags: string[];
      }>(
        `WITH ordered AS (
           SELECT q.id,
                  ROW_NUMBER() OVER (
                    PARTITION BY q.hospital_service_id
                    ORDER BY ${CATEGORY_RANK_SQL}, q.triaged_at ASC NULLS LAST, q.joined_at
                  ) AS position
           FROM queue_entries q
           WHERE q.queue_date = CURRENT_DATE AND q.status = 'waiting'
         )
         SELECT q.id, q.status, h.name AS hospital_name, hs.name AS service_name, h.address, q.joined_at, q.category,
                q.triage_urgency, q.triage_pathway, q.triage_department, q.triage_summary, q.triage_red_flags,
                o.position
         FROM queue_entries q
         JOIN users u ON u.id = q.user_id
         JOIN hospitals h ON h.id = q.hospital_id
         JOIN departments hs ON hs.id = q.hospital_service_id
         LEFT JOIN ordered o ON o.id = q.id
         WHERE u.auth0_subject = $1 AND q.queue_date = CURRENT_DATE AND q.status IN ('awaiting_triage', 'waiting', 'called', 'in_consultation')
         ORDER BY q.joined_at`,
        [req.auth!.subject],
      );
      res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          status: row.status,
          hospitalName: row.hospital_name,
          serviceName: row.service_name,
          address: row.address,
          joinedAt: row.joined_at,
          position: row.position === null ? null : Number(row.position),
          estimatedWaitMinutes: row.position !== null && row.category !== 'emergency' ? Math.max(0, Number(row.position) - 1) * 15 : null,
          category: row.category,
          triageSummary: row.triage_urgency && row.triage_pathway && row.triage_department && row.triage_summary
            ? { urgency: row.triage_urgency, pathwayName: row.triage_pathway, department: row.triage_department, summary: row.triage_summary, redFlags: row.triage_red_flags }
            : null,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/profile', requireAuth, async (req, res, next) => {
    try {
      const profileResult = await getPool().query<{
        id: string; phone: string | null; date_of_birth: string | null; home_address: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null; chronic_conditions: string[]; allergies: string[]; medications: string[]; blood_type: string | null; access_needs: string | null; health_notes: string | null; health_data_consent: boolean;
      }>(
        `SELECT p.id, p.phone, p.date_of_birth, p.home_address, p.emergency_contact_name, p.emergency_contact_phone,
                p.chronic_conditions, p.allergies, p.medications, p.blood_type, p.access_needs, p.health_notes, p.health_data_consent
         FROM patient_profiles p JOIN users u ON u.id = p.user_id WHERE u.auth0_subject = $1`,
        [req.auth!.subject],
      );
      const profile = profileResult.rows[0];
      if (!profile) {
        res.json({ data: { profile: null, diagnoses: [] } });
        return;
      }
      const diagnosesResult = await getPool().query<{ id: string; diagnosis: string; diagnosed_on: string; clinician_name: string | null; notes: string | null }>(
        `SELECT id, diagnosis, diagnosed_on, clinician_name, notes FROM clinical_diagnoses WHERE patient_profile_id = $1 ORDER BY diagnosed_on DESC`,
        [profile.id],
      );
      res.json({ data: { profile: { phone: profile.phone, dateOfBirth: profile.date_of_birth, homeAddress: profile.home_address, emergencyContactName: profile.emergency_contact_name, emergencyContactPhone: profile.emergency_contact_phone, chronicConditions: profile.chronic_conditions, allergies: profile.allergies, medications: profile.medications, bloodType: profile.blood_type, accessNeeds: profile.access_needs, healthNotes: profile.health_notes, healthDataConsent: profile.health_data_consent }, diagnoses: diagnosesResult.rows.map((item) => ({ id: item.id, diagnosis: item.diagnosis, diagnosedOn: item.diagnosed_on, clinicianName: item.clinician_name, notes: item.notes })) } });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/v1/profile', requireAuth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const chronicConditions = textList(body.chronicConditions);
      const allergies = textList(body.allergies);
      const medications = textList(body.medications);
      if (!chronicConditions || !allergies || !medications || typeof body.healthDataConsent !== 'boolean') {
        res.status(400).json({ error: { code: 'INVALID_PROFILE', message: 'Please provide valid health-profile details and consent.' } });
        return;
      }
      const strings = ['phone', 'dateOfBirth', 'homeAddress', 'emergencyContactName', 'emergencyContactPhone', 'bloodType', 'accessNeeds', 'healthNotes'] as const;
      if (strings.some((key) => body[key] !== null && body[key] !== undefined && typeof body[key] !== 'string')) {
        res.status(400).json({ error: { code: 'INVALID_PROFILE', message: 'Profile text fields must be valid text.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await getPool().query(
        `INSERT INTO patient_profiles (user_id, phone, date_of_birth, home_address, emergency_contact_name, emergency_contact_phone, chronic_conditions, allergies, medications, blood_type, access_needs, health_notes, health_data_consent, consented_at)
         VALUES ($1, $2, NULLIF($3, '')::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 THEN now() ELSE NULL END)
         ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, date_of_birth = EXCLUDED.date_of_birth, home_address = EXCLUDED.home_address, emergency_contact_name = EXCLUDED.emergency_contact_name, emergency_contact_phone = EXCLUDED.emergency_contact_phone, chronic_conditions = EXCLUDED.chronic_conditions, allergies = EXCLUDED.allergies, medications = EXCLUDED.medications, blood_type = EXCLUDED.blood_type, access_needs = EXCLUDED.access_needs, health_notes = EXCLUDED.health_notes, health_data_consent = EXCLUDED.health_data_consent, consented_at = CASE WHEN EXCLUDED.health_data_consent THEN COALESCE(patient_profiles.consented_at, now()) ELSE NULL END, updated_at = now()`,
        [user.id, body.phone ?? null, body.dateOfBirth ?? '', body.homeAddress ?? null, body.emergencyContactName ?? null, body.emergencyContactPhone ?? null, chronicConditions, allergies, medications, body.bloodType ?? null, body.accessNeeds ?? null, body.healthNotes ?? null, body.healthDataConsent],
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/queue', requireAuth, async (req, res, next) => {
    try {
      const { hospitalId, serviceId, triageSummary: rawTriageSummary } = req.body as { hospitalId?: unknown; serviceId?: unknown; triageSummary?: unknown };
      if (typeof hospitalId !== 'string' || typeof serviceId !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_QUEUE', message: 'Choose a hospital and service to join the queue.' } });
        return;
      }
      const summary = triageSummary(rawTriageSummary);
      if (summary === undefined) {
        res.status(400).json({ error: { code: 'INVALID_TRIAGE_SUMMARY', message: 'The intake summary is not valid. Please try again.' } });
        return;
      }
      const service = await getPool().query('SELECT 1 FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
      if (!service.rowCount) {
        res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That service is not available at the selected hospital.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const result = await getPool().query<{ id: string }>(
        `INSERT INTO queue_entries (user_id, hospital_id, hospital_service_id, status, triage_urgency, triage_pathway, triage_department, triage_summary, triage_red_flags)
         VALUES ($1, $2, $3, 'awaiting_triage', $4, $5, $6, $7, $8) RETURNING id`,
        [user.id, hospitalId, serviceId, summary?.urgency ?? null, summary?.pathwayName ?? null, summary?.department ?? null, summary?.summary ?? null, summary?.redFlags ?? []],
      );
      res.status(201).json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/v1/queue/:id', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{ id: string }>(
        `UPDATE queue_entries q SET status = 'cancelled', updated_at = now()
         FROM users u
         WHERE q.id = $1 AND q.user_id = u.id AND u.auth0_subject = $2
           AND q.queue_date = CURRENT_DATE AND q.status IN ('waiting', 'awaiting_triage')
         RETURNING q.id`,
        [req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'QUEUE_ENTRY_NOT_FOUND', message: 'That active queue entry was not found.' } });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/staff/triage', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Nurse access is required to review triage.' } });
        return;
      }
      const result = await getPool().query<{
        id: string; joined_at: string; appointment_time: string | null; from_booking: boolean; service_id: string; service_name: string;
        patient_name: string | null; patient_email: string | null; triage_urgency: QuestionnaireUrgency | null; triage_pathway: string | null;
        triage_department: string | null; triage_summary: string | null; triage_red_flags: string[];
      }>(
        `SELECT q.id, q.joined_at, a.appointment_time, q.appointment_id IS NOT NULL AS from_booking,
                q.hospital_service_id AS service_id, hs.name AS service_name,
                u.display_name AS patient_name, u.email AS patient_email,
                q.triage_urgency, q.triage_pathway, q.triage_department, q.triage_summary, q.triage_red_flags
         FROM queue_entries q
         JOIN users u ON u.id = q.user_id
         JOIN departments hs ON hs.id = q.hospital_service_id
         LEFT JOIN appointments a ON a.id = q.appointment_id
         WHERE q.hospital_id = $1 AND q.queue_date = CURRENT_DATE AND q.status = 'awaiting_triage'
         ORDER BY CASE WHEN q.triage_urgency = 'emergency' OR cardinality(q.triage_red_flags) > 0 THEN 0 ELSE 1 END,
                  CASE q.triage_urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'priority' THEN 2 ELSE 3 END,
                  q.joined_at`,
        [membership.hospitalId],
      );
      res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          patientName: row.patient_name ?? 'Unknown patient',
          patientEmail: row.patient_email,
          source: row.from_booking ? 'booking' : 'walk_in',
          serviceId: row.service_id,
          serviceName: row.service_name,
          appointmentTime: row.appointment_time ? row.appointment_time.slice(0, 5) : null,
          joinedAt: row.joined_at,
          critical: row.triage_urgency === 'emergency' || row.triage_red_flags.length > 0,
          intakeNote: row.triage_summary,
          triageSummary: row.triage_urgency && row.triage_pathway && row.triage_department && row.triage_summary
            ? { urgency: row.triage_urgency, pathwayName: row.triage_pathway, department: row.triage_department, summary: row.triage_summary, redFlags: row.triage_red_flags }
            : null,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/staff/triage/:id/confirm', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Nurse access is required to confirm triage.' } });
        return;
      }
      const { category, serviceId, reason } = req.body as { category?: unknown; serviceId?: unknown; reason?: unknown };
      if (category !== 'emergency' && category !== 'urgent' && category !== 'priority' && category !== 'routine') {
        res.status(400).json({ error: { code: 'INVALID_TRIAGE', message: 'Choose a valid urgency category.' } });
        return;
      }
      if (serviceId !== undefined && typeof serviceId !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_TRIAGE', message: 'Choose a valid department.' } });
        return;
      }
      const entry = await getPool().query<{ id: string; hospital_service_id: string }>(
        `SELECT id, hospital_service_id FROM queue_entries
         WHERE id = $1 AND hospital_id = $2 AND queue_date = CURRENT_DATE AND status = 'awaiting_triage'`,
        [req.params.id, membership.hospitalId],
      );
      if (!entry.rowCount) {
        res.status(404).json({ error: { code: 'ENTRY_NOT_FOUND', message: 'That patient is no longer awaiting triage.' } });
        return;
      }
      let targetServiceId = entry.rows[0]!.hospital_service_id;
      if (serviceId) {
        const service = await getPool().query('SELECT 1 FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, membership.hospitalId]);
        if (!service.rowCount) {
          res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That department is not available at your hospital.' } });
          return;
        }
        targetServiceId = serviceId;
      }
      const reasonText = boundedText(reason, '', 300);
      const updated = await getPool().query<{ id: string }>(
        `UPDATE queue_entries
         SET category = $2, hospital_service_id = $3, override_reason = NULLIF($4, ''),
             status = 'waiting', triaged_at = now(), triaged_by = $5, updated_at = now(),
             acknowledged_at = CASE WHEN $2 = 'emergency' THEN now() ELSE acknowledged_at END,
             acknowledged_by = CASE WHEN $2 = 'emergency' THEN $5 ELSE acknowledged_by END
         WHERE id = $1
         RETURNING id`,
        [req.params.id, category, targetServiceId, reasonText, membership.userId],
      );
      res.json({ data: { id: updated.rows[0]!.id, category, serviceId: targetServiceId } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/staff/queue', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'doctor', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required to view the queue.' } });
        return;
      }
      const result = await getPool().query<{
        id: string; status: string; category: QuestionnaireUrgency | null; service_id: string; service_name: string;
        patient_name: string | null; joined_at: string; triaged_at: string | null; called_at: string | null; position: number | null;
      }>(
        `WITH ordered AS (
           SELECT q.id,
                  ROW_NUMBER() OVER (
                    PARTITION BY q.hospital_service_id
                    ORDER BY ${CATEGORY_RANK_SQL}, q.triaged_at ASC NULLS LAST, q.joined_at
                  ) AS position
           FROM queue_entries q
           WHERE q.hospital_id = $1 AND q.queue_date = CURRENT_DATE AND q.status = 'waiting'
         )
         SELECT q.id, q.status, q.category, q.hospital_service_id AS service_id, hs.name AS service_name,
                u.display_name AS patient_name, q.joined_at, q.triaged_at, q.called_at, o.position
         FROM queue_entries q
         JOIN users u ON u.id = q.user_id
         JOIN departments hs ON hs.id = q.hospital_service_id
         LEFT JOIN ordered o ON o.id = q.id
         WHERE q.hospital_id = $1 AND q.queue_date = CURRENT_DATE AND q.status IN ('waiting', 'called', 'in_consultation')
         ORDER BY hs.name, ${CATEGORY_RANK_SQL.replaceAll('category', 'q.category')}, q.triaged_at ASC NULLS LAST, q.joined_at`,
        [membership.hospitalId],
      );
      res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          patientName: row.patient_name ?? 'Unknown patient',
          serviceId: row.service_id,
          serviceName: row.service_name,
          status: row.status,
          category: row.category,
          position: row.position === null ? null : Number(row.position),
          joinedAt: row.joined_at,
          triagedAt: row.triaged_at,
          calledAt: row.called_at,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/staff/queue/:id/call', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'doctor', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE queue_entries SET status = 'called', called_at = now(), updated_at = now()
         WHERE id = $1 AND hospital_id = $2 AND queue_date = CURRENT_DATE AND status = 'waiting'
         RETURNING id`,
        [req.params.id, membership.hospitalId],
      );
      if (!result.rowCount) {
        res.status(409).json({ error: { code: 'ENTRY_NOT_WAITING', message: 'That patient is no longer waiting in the queue.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id, status: 'called' } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/staff/queue/:id/start-consultation', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'doctor', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE queue_entries SET status = 'in_consultation', updated_at = now()
         WHERE id = $1 AND hospital_id = $2 AND queue_date = CURRENT_DATE AND status = 'called'
         RETURNING id`,
        [req.params.id, membership.hospitalId],
      );
      if (!result.rowCount) {
        res.status(409).json({ error: { code: 'ENTRY_NOT_CALLED', message: 'That patient has not been called yet.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id, status: 'in_consultation' } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/staff/queue/:id/complete', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'doctor', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE queue_entries SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = $1 AND hospital_id = $2 AND queue_date = CURRENT_DATE AND status = 'in_consultation'
         RETURNING id`,
        [req.params.id, membership.hospitalId],
      );
      if (!result.rowCount) {
        res.status(409).json({ error: { code: 'ENTRY_NOT_IN_CONSULTATION', message: 'That consultation has not started.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id, status: 'completed' } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/staff/queue/:id/refer', requireAuth, async (req, res, next) => {
    try {
      const membership = await staffMembership(req.auth!.subject, ['nurse', 'doctor', 'administrator']);
      if (!membership) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Hospital staff access is required.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const { serviceId, reason } = req.body as { serviceId?: unknown; reason?: unknown };
      const reasonText = boundedText(reason, '', 300);
      if (typeof serviceId !== 'string' || !reasonText || reasonText.length < 4) {
        res.status(400).json({ error: { code: 'INVALID_REFERRAL', message: 'Choose a receiving department and describe the referral reason.' } });
        return;
      }
      const entry = await getPool().query<{ id: string; user_id: string; hospital_service_id: string }>(
        `SELECT id, user_id, hospital_service_id FROM queue_entries
         WHERE id = $1 AND hospital_id = $2 AND queue_date = CURRENT_DATE AND status IN ('called', 'in_consultation')`,
        [req.params.id, membership.hospitalId],
      );
      if (!entry.rowCount) {
        res.status(409).json({ error: { code: 'ENTRY_NOT_ACTIVE', message: 'Only a called or consulting patient can be referred.' } });
        return;
      }
      if (serviceId === entry.rows[0]!.hospital_service_id) {
        res.status(400).json({ error: { code: 'INVALID_REFERRAL', message: 'Choose a different department than the current queue.' } });
        return;
      }
      const service = await getPool().query<{ name: string }>('SELECT name FROM departments WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, membership.hospitalId]);
      if (!service.rowCount) {
        res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That department is not available at your hospital.' } });
        return;
      }
      const clinicianName = user.display_name ?? 'Clinical staff';
      const referral = await getPool().query<{ id: string }>(
        `INSERT INTO queue_entries (user_id, hospital_id, hospital_service_id, status, triage_pathway, triage_department, triage_summary)
         VALUES ($1, $2, $3, 'awaiting_triage', 'Clinical referral', $4, $5) RETURNING id`,
        [entry.rows[0]!.user_id, membership.hospitalId, serviceId, service.rows[0]!.name, `Referred by ${clinicianName}: ${reasonText}`],
      );
      await getPool().query(
        `UPDATE queue_entries SET status = 'referred', completed_at = now(), updated_at = now() WHERE id = $1`,
        [req.params.id],
      );
      res.status(201).json({ data: { id: referral.rows[0]!.id, status: 'awaiting_triage' } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/display/:token', async (req, res, next) => {
    try {
      const token = req.params.token;
      if (!/^[A-Za-z0-9_-]{10,120}$/.test(token)) {
        res.status(404).json({ error: { code: 'DISPLAY_NOT_FOUND', message: 'That display was not found.' } });
        return;
      }
      const hospital = await getPool().query<{ id: string; name: string }>(
        `SELECT id, name FROM hospitals
         WHERE display_token = $1 AND display_active AND active`,
        [token],
      );
      if (!hospital.rowCount) {
        res.status(404).json({ error: { code: 'DISPLAY_NOT_FOUND', message: 'That display was not found.' } });
        return;
      }
      const rows = await getPool().query<{ service_id: string; service_name: string; status: string; category: QuestionnaireUrgency | null; ticket: number }>(
        `WITH tickets AS (
           SELECT q.hospital_service_id, q.status, q.category,
                  ROW_NUMBER() OVER (PARTITION BY q.hospital_service_id ORDER BY q.joined_at) AS ticket
           FROM queue_entries q
           WHERE q.hospital_id = $1 AND q.queue_date = CURRENT_DATE AND q.status NOT IN ('cancelled', 'referred')
         )
         SELECT t.hospital_service_id AS service_id, hs.name AS service_name, t.status, t.category, t.ticket
         FROM tickets t JOIN departments hs ON hs.id = t.hospital_service_id
         ORDER BY hs.name, t.ticket`,
        [hospital.rows[0]!.id],
      );
      const services = new Map<string, { serviceName: string; nowServing: number | null; awaitingTriage: number; waiting: { ticket: number; category: QuestionnaireUrgency | null }[] }>();
      for (const row of rows.rows) {
        const service = services.get(row.service_id) ?? { serviceName: row.service_name, nowServing: null, awaitingTriage: 0, waiting: [] };
        if (row.status === 'awaiting_triage') service.awaitingTriage += 1;
        if (row.status === 'waiting') service.waiting.push({ ticket: Number(row.ticket), category: row.category });
        if ((row.status === 'called' || row.status === 'in_consultation') && service.nowServing === null) service.nowServing = Number(row.ticket);
        services.set(row.service_id, service);
      }
      res.json({ data: { hospitalName: hospital.rows[0]!.name, generatedAt: new Date().toISOString(), services: [...services.values()] } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/sample', requireAuth, async (req, res, next) => {
    try {
      const existing = await getPool().query('SELECT 1 FROM users WHERE auth0_subject = $1', [req.auth!.subject]);
      if (!existing.rowCount) {
        res.status(403).json({ error: { code: 'USER_NOT_SYNCHRONIZED', message: 'Call /api/v1/me first' } });
        return;
      }
      res.json({ data: { message: 'Your protected NovaCare API connection is active.' } });
    } catch (error) {
      next(error);
    }
  });

  // Public USSD channel for Africa's Talking sandbox callbacks. Unauthenticated by design
  // (Africa's Talking calls it externally); add callback validation/security before production.
  app.post('/api/v1/channels/ussd', express.urlencoded({ extended: false }), createUssdCallbackHandler({
    dispatch: channelDispatch,
    store: channelStore,
    context: channelContext,
  }));

  // Public inbound SMS channel for Africa's Talking sandbox two-way SMS. Unauthenticated by
  // design (Africa's Talking calls it externally); add callback validation/security before production.
  app.post('/api/v1/channels/sms/incoming', express.urlencoded({ extended: false }), createSmsIncomingHandler({
    dispatch: channelDispatch,
    store: channelStore,
    context: channelContext,
  }));

  // Dispatch Core: shared service-request domain (all simulated — demo prototype).
  const dispatch = createDispatchController(dispatchService, dispatchHub);

  app.post('/api/v1/service-requests', requireAuth, dispatch.createRequest);
  app.get('/api/v1/service-requests', requireAuth, dispatch.listMine);
  app.get('/api/v1/service-requests/events', requireAuth, requireRole('dispatcher', 'administrator'), dispatch.events);
  app.get('/api/v1/service-requests/:id', requireAuth, dispatch.getRequest);

  app.get('/api/v1/dispatcher/service-requests', requireAuth, requireRole('dispatcher', 'administrator'), dispatch.queue);
  app.get('/api/v1/dispatcher/service-requests/:id', requireAuth, requireRole('dispatcher', 'administrator'), dispatch.detail);
  app.post('/api/v1/dispatcher/service-requests/:id/acknowledge', requireAuth, requireRole('dispatcher'), dispatch.acknowledge);
  app.post('/api/v1/dispatcher/service-requests/:id/respond', requireAuth, requireRole('dispatcher'), dispatch.respond);
  app.post('/api/v1/dispatcher/service-requests/:id/assign-facility', requireAuth, requireRole('dispatcher'), dispatch.assignFacility);
  app.post('/api/v1/dispatcher/service-requests/:id/assign-responder', requireAuth, requireRole('dispatcher'), dispatch.assignResponder);
  app.get('/api/v1/dispatcher/available-responders', requireAuth, requireRole('dispatcher'), dispatch.availableResponders);
  app.patch('/api/v1/dispatcher/service-requests/:id/status', requireAuth, requireRole('dispatcher'), dispatch.updateStatus);

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    console.error(error);
    if (error instanceof Error && error.message.startsWith('Gemini intake chat')) {
      res.status(502).json({ error: { code: 'INTAKE_CHAT_UNAVAILABLE', message: 'The AI intake service returned an invalid response. Please try again.' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'appointments_booked_service_slot_key') {
      res.status(409).json({ error: { code: 'SLOT_UNAVAILABLE', message: 'This appointment slot is no longer available. Please choose another time.' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'queue_entries_one_active_service_per_day') {
      res.status(409).json({ error: { code: 'ALREADY_IN_QUEUE', message: 'This patient is already active in that service queue today.' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && String(error.constraint).startsWith('appointment_slots_')) {
      res.status(409).json({ error: { code: 'SLOTS_EXIST', message: 'Slots already exist for that department, date, and time.' } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}
