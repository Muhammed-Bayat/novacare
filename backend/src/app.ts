import cors from 'cors';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { getPool } from './db.js';
import { buildInvitationUrl, sendInvitationEmail } from './email.js';

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

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value.map((item) => item.trim()).filter(Boolean).slice(0, 50);
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

async function createAndSendInvitation(input: { hospitalId: string; hospitalName: string; email: string; role: 'administrator' | 'nurse' | 'doctor'; invitedBy: string; baseUrl: string }): Promise<{ claimUrl: string }> {
  const token = invitationToken();
  const claimUrl = buildInvitationUrl(token, input.baseUrl);
  const invitation = await getPool().query(
    `INSERT INTO staff_invitations (hospital_id, email, role, invited_by, token_hash, expires_at, claimed_by, claimed_at, sent_at)
     VALUES ($1, lower($2), $3, $4, $5, now() + interval '72 hours', NULL, NULL, NULL)
     ON CONFLICT (hospital_id, email, role) DO UPDATE
     SET invited_by = EXCLUDED.invited_by, token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
         claimed_by = NULL, claimed_at = NULL, sent_at = NULL
     WHERE staff_invitations.claimed_at IS NULL`,
    [input.hospitalId, input.email, input.role, input.invitedBy, tokenHash(token)],
  );
  if (!invitation.rowCount) throw new Error('This recipient has already claimed this hospital role.');
  await sendInvitationEmail({ recipient: input.email, role: input.role, hospitalName: input.hospitalName, claimUrl });
  await getPool().query(
    `UPDATE staff_invitations SET sent_at = now()
     WHERE hospital_id = $1 AND lower(email) = lower($2) AND role = $3 AND token_hash = $4`,
    [input.hospitalId, input.email, input.role, tokenHash(token)],
  );
  return { claimUrl };
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

type StaffRole = 'administrator' | 'nurse' | 'doctor';
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

export function createApp() {
  const app = express();
  const origins = allowedOrigins();

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
         JOIN hospital_services hs ON hs.hospital_id = h.id AND hs.active
         WHERE h.active AND ($1 = '' OR h.name ILIKE '%' || $1 || '%')
           AND ($2 = '' OR h.province ILIKE '%' || $2 || '%' OR h.address ILIKE '%' || $2 || '%')
           AND ($3 = '' OR EXISTS (
             SELECT 1 FROM hospital_services matching_service
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

  app.post('/api/v1/admin/staff', requireAuth, async (req, res, next) => {
    try {
      const membership = await getPool().query<{ hospital_id: string; hospital_name: string }>(`SELECT hm.hospital_id, h.name AS hospital_name FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id JOIN hospitals h ON h.id = hm.hospital_id WHERE u.auth0_subject = $1 AND hm.role = 'administrator' AND hm.active`, [req.auth!.subject]);
      const hospitalId = membership.rows[0]?.hospital_id;
      const { email, role } = req.body as { email?: unknown; role?: unknown };
      if (!hospitalId || typeof email !== 'string' || !email.includes('@') || (role !== 'administrator' && role !== 'nurse' && role !== 'doctor')) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Choose a valid team role and email.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const { claimUrl } = await createAndSendInvitation({ hospitalId, hospitalName: membership.rows[0]!.hospital_name, email, role, invitedBy: user.id, baseUrl: resolveBaseUrl(req) });
      const roleLabel = role === 'administrator' ? 'Administrator' : role === 'nurse' ? 'Staff' : 'Doctor';
      res.status(201).json({ data: { message: `${roleLabel} invitation email sent. It expires in 72 hours.`, claimUrl } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/staff', requireAuth, async (req, res, next) => {
    try {
      const membership = await getPool().query<{ hospital_id: string; hospital_name: string }>(`SELECT hm.hospital_id, h.name AS hospital_name FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id JOIN hospitals h ON h.id = hm.hospital_id WHERE u.auth0_subject = $1 AND hm.role = 'administrator' AND hm.active`, [req.auth!.subject]);
      const hospital = membership.rows[0];
      if (!hospital) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } }); return; }
      const members = await getPool().query<{ email: string | null; display_name: string | null; role: 'administrator' | 'nurse' | 'doctor'; created_at: string }>(
        `SELECT u.email, u.display_name, hm.role, hm.created_at
         FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id
         WHERE hm.hospital_id = $1 AND hm.active
         ORDER BY hm.created_at`,
        [hospital.hospital_id],
      );
      const invitations = await getPool().query<{ email: string; role: 'administrator' | 'nurse' | 'doctor'; expires_at: string; sent_at: string | null }>(
        `SELECT email, role, expires_at, sent_at
         FROM staff_invitations
         WHERE hospital_id = $1 AND claimed_at IS NULL
         ORDER BY created_at DESC`,
        [hospital.hospital_id],
      );
      const display = await getPool().query<{ token: string }>('SELECT token FROM hospital_display_tokens WHERE hospital_id = $1', [hospital.hospital_id]);
      res.json({
        data: {
          hospitalId: hospital.hospital_id,
          hospitalName: hospital.hospital_name,
          displayPath: display.rows[0] ? `/display/${display.rows[0].token}` : null,
          members: members.rows.map((row) => ({ email: row.email, displayName: row.display_name, role: row.role, since: row.created_at })),
          pendingInvitations: invitations.rows.map((row) => ({ email: row.email, role: row.role, expiresAt: row.expires_at, sentAt: row.sent_at })),
        },
      });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/invitations/claim', requireAuth, async (req, res, next) => {
    try {
      const { token } = req.body as { token?: unknown };
      if (typeof token !== 'string' || token.length < 20) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'This invitation link is invalid.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      if (!user.email) { res.status(400).json({ error: { code: 'EMAIL_REQUIRED', message: 'Your sign-in account must have an email address.' } }); return; }
      const claim = await getPool().query<{ hospital_id: string; role: 'administrator' | 'nurse' | 'doctor' }>(
        `UPDATE staff_invitations SET claimed_by = $1, claimed_at = now()
         WHERE token_hash = $2 AND lower(email) = lower($3) AND claimed_at IS NULL AND expires_at > now()
         RETURNING hospital_id, role`,
        [user.id, tokenHash(token), user.email],
      );
      const invitation = claim.rows[0];
      if (!invitation) { res.status(400).json({ error: { code: 'INVITATION_UNAVAILABLE', message: 'This invitation is expired, already claimed, or belongs to another email address.' } }); return; }
      await getPool().query(
        `INSERT INTO hospital_memberships (user_id, hospital_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, hospital_id) DO UPDATE SET role = EXCLUDED.role, active = true`,
        [user.id, invitation.hospital_id, invitation.role],
      );
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
         JOIN hospital_services hs ON hs.id = a.hospital_service_id
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
      const service = await getPool().query('SELECT 1 FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
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
           AND EXISTS (SELECT 1 FROM hospital_services hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
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
           AND EXISTS (SELECT 1 FROM hospital_services hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
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
         JOIN hospital_services hs ON hs.id = q.hospital_service_id
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
      const service = await getPool().query('SELECT 1 FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
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
         JOIN hospital_services hs ON hs.id = q.hospital_service_id
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
        const service = await getPool().query('SELECT 1 FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, membership.hospitalId]);
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
         JOIN hospital_services hs ON hs.id = q.hospital_service_id
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
      const service = await getPool().query<{ name: string }>('SELECT name FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, membership.hospitalId]);
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
        `SELECT h.id, h.name FROM hospitals h JOIN hospital_display_tokens t ON t.hospital_id = h.id
         WHERE t.token = $1 AND h.active`,
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
         FROM tickets t JOIN hospital_services hs ON hs.id = t.hospital_service_id
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
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}
