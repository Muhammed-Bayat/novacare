export type QuestionnaireUrgency = 'emergency' | 'urgent' | 'priority' | 'routine';
export type QuestionnaireQuestionType = 'single' | 'yes-no' | 'scale';
export type QuestionnaireAnswerValue = string | number | boolean;

export interface QuestionnaireOption {
  id: string;
  label: string;
  value: QuestionnaireAnswerValue;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  helper?: string;
  type: QuestionnaireQuestionType;
  options?: QuestionnaireOption[];
  min?: number;
  max?: number;
}

export interface QuestionnairePathway {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  department: string;
  urgency: QuestionnaireUrgency;
  questions: QuestionnaireQuestion[];
}

export type IntakeSource = 'ai' | 'local-fallback';
export type FallbackReason =
  | 'missing-api-key'
  | 'provider-auth'
  | 'provider-rate-limit'
  | 'provider-quota'
  | 'provider-billing'
  | 'provider-model'
  | 'provider-request'
  | 'provider-server-error'
  | 'network'
  | 'timeout'
  | 'invalid-json'
  | 'schema-validation'
  | 'invalid-pathway';

export interface QuestionnaireIntake {
  pathwayId: string;
  pathwayName: string;
  questions: QuestionnaireQuestion[];
  source: IntakeSource;
  fallbackReason?: FallbackReason;
}

export interface QuestionnaireAnswer {
  questionId: string;
  value: QuestionnaireAnswerValue;
}

export interface QuestionnaireAssessment {
  pathwayId: string;
  pathwayName: string;
  summary: string;
  department: string;
  urgency: QuestionnaireUrgency;
  redFlags: string[];
}

export type QuestionnaireInterpretationType = 'answer' | 'explanation' | 'clarification-needed' | 'conversation';
export type QuestionnaireInterpretationStatus = 'success' | 'failed';

export interface QuestionnaireInterpretation {
  type: QuestionnaireInterpretationType;
  answerId: string | null;
  confidence: number | null;
  message: string;
  interpretationStatus: QuestionnaireInterpretationStatus;
}

export const questionnairePathways: QuestionnairePathway[] = [
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
    description: 'Symptoms that do not clearly match one of the focused assessment pathways.',
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

export function normalizePathwayId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function findQuestionnairePathway(value: string): QuestionnairePathway | undefined {
  const id = normalizePathwayId(value);
  return questionnairePathways.find((pathway) => pathway.id === id);
}

export function localClassifyPathway(complaint: string): QuestionnairePathway {
  const text = complaint.toLowerCase();
  let selected = questionnairePathways.find((pathway) => pathway.id === 'general')!;
  let bestScore = 0;
  for (const pathway of questionnairePathways) {
    if (pathway.id === 'general') continue;
    const score = pathway.keywords.reduce((total, keyword) => total + (text.includes(keyword) ? Math.max(1, keyword.split(' ').length) : 0), 0);
    if (score > bestScore) {
      selected = pathway;
      bestScore = score;
    }
  }
  return selected;
}

export function createQuestionnaireIntake(pathway: QuestionnairePathway, source: IntakeSource, fallbackReason?: FallbackReason): QuestionnaireIntake {
  return {
    pathwayId: pathway.id,
    pathwayName: pathway.name,
    questions: pathway.questions,
    source,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function sameValue(left: QuestionnaireAnswerValue, right: QuestionnaireAnswerValue): boolean {
  return typeof left === typeof right && left === right;
}

export function validateQuestionnaireAnswers(pathway: QuestionnairePathway, value: unknown): Map<string, QuestionnaireAnswerValue> | undefined {
  if (!Array.isArray(value) || value.length !== pathway.questions.length) return undefined;
  const supplied = new Map<string, QuestionnaireAnswerValue>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const questionId = typeof entry.questionId === 'string' ? entry.questionId : '';
    const answer = entry.value;
    const question = pathway.questions.find((item) => item.id === questionId);
    if (!question || supplied.has(questionId) || (typeof answer !== 'string' && typeof answer !== 'number' && typeof answer !== 'boolean')) return undefined;
    if (question.type === 'scale') {
      if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < (question.min ?? 0) || answer > (question.max ?? 10)) return undefined;
    } else if (!question.options?.some((option) => sameValue(option.value, answer))) {
      return undefined;
    }
    supplied.set(questionId, answer);
  }
  return supplied.size === pathway.questions.length ? supplied : undefined;
}

function higherUrgency(current: QuestionnaireUrgency, next: QuestionnaireUrgency): QuestionnaireUrgency {
  const rank: Record<QuestionnaireUrgency, number> = { routine: 0, priority: 1, urgent: 2, emergency: 3 };
  return rank[next] > rank[current] ? next : current;
}

export function evaluateQuestionnaire(pathway: QuestionnairePathway, answers: Map<string, QuestionnaireAnswerValue>): QuestionnaireAssessment {
  const yes = (questionId: string) => answers.get(questionId) === true;
  const value = (questionId: string) => answers.get(questionId);
  const scaleAtLeast = (questionId: string, minimum: number) => {
    const answer = value(questionId);
    return typeof answer === 'number' && answer >= minimum;
  };
  const redFlags: string[] = [];
  let urgency = pathway.urgency;
  const flag = (condition: boolean, message: string, level: QuestionnaireUrgency) => {
    if (!condition) return;
    redFlags.push(message);
    urgency = higherUrgency(urgency, level);
  };

  switch (pathway.id) {
    case 'chest-breathing':
      flag(yes('chest_now'), 'Chest pain or pressure reported', 'emergency');
      flag(yes('breath_now'), 'Breathing difficulty reported', 'emergency');
      flag(yes('radiating'), 'Pain spreading to the arm, jaw, shoulder or back reported', 'urgent');
      flag(scaleAtLeast('pain_level', 8), 'Severe discomfort reported', 'urgent');
      break;
    case 'injury':
      flag(yes('deformity'), 'Possible serious injury warning sign reported', 'emergency');
      flag(value('weight_bearing') === 'no', 'Unable to bear weight reported', 'urgent');
      flag(scaleAtLeast('pain_level', 8), 'Severe pain reported', 'urgent');
      break;
    case 'abdominal':
      flag(yes('fainting'), 'Fainting, near-fainting or significant blood reported', 'emergency');
      flag(yes('vomiting'), 'Repeated vomiting or inability to keep fluids down reported', 'urgent');
      flag(scaleAtLeast('pain_level', 8), 'Severe abdominal pain reported', 'urgent');
      break;
    case 'headache':
      flag(yes('sudden_onset'), 'Sudden severe headache reported', 'emergency');
      flag(yes('neuro_signs'), 'New neurological warning signs reported', 'emergency');
      flag(scaleAtLeast('pain_level', 8), 'Severe headache reported', 'urgent');
      break;
    case 'general':
      flag(yes('danger_signs'), 'Serious warning signs reported', 'emergency');
      flag(yes('worsening'), 'Symptoms getting rapidly worse reported', 'urgent');
      flag(scaleAtLeast('severity', 8), 'Severe overall illness reported', 'urgent');
      break;
  }

  return {
    pathwayId: pathway.id,
    pathwayName: pathway.name,
    summary: `Completed the ${pathway.name} questionnaire.`,
    department: pathway.department,
    urgency,
    redFlags,
  };
}
