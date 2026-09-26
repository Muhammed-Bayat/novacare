import { useMemo, useState, type FormEvent } from 'react';
import type { AppointmentTriageSummary, Hospital, QuestionnaireIntake, QuestionnaireQuestion, QuestionnaireUrgency } from '../../api.ts';

type Stage = 'intro' | 'questions' | 'result';

type QuestionnaireResult = {
  urgency: QuestionnaireUrgency;
  department: string;
  redFlags: string[];
  reason: string;
};

function urgencyText(urgency: QuestionnaireUrgency) {
  switch (urgency) {
    case 'emergency': return { label: 'Emergency assessment', detail: 'Warning signs were reported, so urgent in-person assessment is recommended.' };
    case 'urgent': return { label: 'Urgent', detail: 'Your answers suggest prompt clinical review is a safer next step.' };
    case 'priority': return { label: 'Priority', detail: 'Your answers should be reviewed before routine visits where possible.' };
    default: return { label: 'Routine', detail: 'Your answers appear suitable for a standard booking pathway in this demo.' };
  }
}

function selectedNumber(answers: Record<string, unknown>, key: string): number {
  const value = answers[key];
  return typeof value === 'number' ? value : 0;
}

function isYes(answers: Record<string, unknown>, key: string): boolean {
  return answers[key] === true || answers[key] === 'yes';
}

function serviceKeywords(intake: QuestionnaireIntake, department: string): string[] {
  const text = `${intake.pathwayName} ${department}`.toLowerCase();
  if (text.includes('emergency') || text.includes('chest') || text.includes('breathing')) return ['emergency', 'trauma', 'cardiology', 'general'];
  if (text.includes('ortho') || text.includes('injury') || text.includes('musculoskeletal')) return ['orthopaedic', 'orthopedic', 'injury', 'trauma', 'general'];
  if (text.includes('abdominal')) return ['general', 'surgery', 'gastro', 'emergency'];
  if (text.includes('headache') || text.includes('neuro')) return ['general', 'neurology', 'emergency'];
  return ['general', 'family', 'outpatient', 'emergency'];
}

function recommendedHospitals(hospitals: Hospital[], intake: QuestionnaireIntake, department: string): Hospital[] {
  const keywords = serviceKeywords(intake, department);
  const matches = hospitals.filter((hospital) => hospital.services.some((service) => {
    const name = service.name.toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  }));
  return (matches.length > 0 ? matches : hospitals).slice(0, 3);
}

function matchingServices(hospital: Hospital, intake: QuestionnaireIntake, department: string): Hospital['services'] {
  const keywords = serviceKeywords(intake, department);
  const services = hospital.services.filter((service) => {
    const name = service.name.toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  });
  return (services.length > 0 ? services : hospital.services).slice(0, 3);
}

function appointmentSummary(intake: QuestionnaireIntake, result: QuestionnaireResult): AppointmentTriageSummary {
  return {
    urgency: result.urgency,
    pathwayName: intake.pathwayName,
    department: result.department,
    summary: result.reason,
    redFlags: result.redFlags,
  };
}

function buildQuestionnaireResult(intake: QuestionnaireIntake, answers: Record<string, unknown>): QuestionnaireResult {
  const redFlags: string[] = [];
  if (isYes(answers, 'breath_now')) redFlags.push('Breathing difficulty reported');
  if (isYes(answers, 'chest_now') && isYes(answers, 'radiating')) redFlags.push('Chest discomfort spreading to another area');
  if (isYes(answers, 'deformity')) redFlags.push('Severe injury sign reported');
  if (answers.weight_bearing === 'no') redFlags.push('Unable to use or bear weight on the injured area');
  if (isYes(answers, 'fainting')) redFlags.push('Fainting or significant bleeding reported');
  if (isYes(answers, 'neuro_signs')) redFlags.push('New neurological warning signs reported');
  if (isYes(answers, 'danger_signs')) redFlags.push('Potential emergency warning sign reported');

  const pain = Math.max(selectedNumber(answers, 'pain_level'), selectedNumber(answers, 'severity'));
  const urgency = redFlags.length > 0
    ? 'emergency'
    : pain >= 8 || isYes(answers, 'worsening')
      ? 'urgent'
      : pain >= 5 || answers.weight_bearing === 'painful'
        ? 'priority'
        : intake.urgency;
  const department = urgency === 'emergency' ? 'Emergency Department' : intake.department;
  const reason = redFlags.length > 0
    ? `Your answers include ${redFlags.length} warning sign${redFlags.length > 1 ? 's' : ''}, so this demo recommends emergency assessment rather than routine booking.`
    : `Your symptoms most closely match ${intake.pathwayName.toLowerCase()}, so this demo recommends ${department}.`;

  return { urgency, department, redFlags, reason };
}

function QuestionControl({ question, value, onChange }: { question: QuestionnaireQuestion; value: unknown; onChange: (value: unknown) => void }) {
  if (question.type === 'scale') {
    const min = question.min ?? 0;
    const max = question.max ?? 10;
    const selected = typeof value === 'number' ? value : Math.ceil((min + max) / 2);
    return (
      <div className="nv-questionnaire-scale">
        <div className="nv-scale-value">{selected}<span> / {max}</span></div>
        <input type="range" min={min} max={max} value={selected} onChange={(event) => onChange(Number(event.target.value))} />
        <div className="nv-scale-labels"><span>Lower</span><span>Higher</span></div>
      </div>
    );
  }

  return (
    <div className="nv-questionnaire-options">
      {question.options?.map((option) => (
        <button
          key={option.id}
          className={`nv-questionnaire-option ${value === option.value ? 'selected' : ''}`}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PatientQuestionnaire({
  isAuthenticated,
  hospitals,
  onSignIn,
  onCreateIntake,
  onBookAppointment,
}: {
  isAuthenticated: boolean;
  hospitals: Hospital[];
  onSignIn: () => void;
  onCreateIntake: (complaint: string) => Promise<QuestionnaireIntake>;
  onBookAppointment: (input: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary }) => void;
}) {
  const [stage, setStage] = useState<Stage>('intro');
  const [complaint, setComplaint] = useState('');
  const [intake, setIntake] = useState<QuestionnaireIntake | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<QuestionnaireResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const question = intake?.questions[questionIndex];
  const progress = stage === 'intro' ? 12 : stage === 'result' ? 100 : intake ? 28 + ((questionIndex + 1) / intake.questions.length) * 62 : 28;
  const canContinue = useMemo(() => question?.type === 'scale' || (question ? answers[question.id] !== undefined : false), [answers, question]);
  const recommendations = intake && result ? recommendedHospitals(hospitals, intake, result.department) : [];
  const resultSummary = intake && result ? appointmentSummary(intake, result) : undefined;

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      onSignIn();
      return;
    }
    if (complaint.trim().length < 4) return;
    setLoading(true);
    setError(undefined);
    try {
      const nextIntake = await onCreateIntake(complaint.trim());
      setIntake(nextIntake);
      setAnswers({});
      setQuestionIndex(0);
      setResult(null);
      setStage('questions');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not prepare the questionnaire.');
    } finally {
      setLoading(false);
    }
  }

  function nextQuestion() {
    if (!intake || !question) return;
    const completedAnswers = question.type === 'scale' && answers[question.id] === undefined
      ? { ...answers, [question.id]: Math.ceil(((question.min ?? 0) + (question.max ?? 10)) / 2) }
      : answers;
    if (questionIndex < intake.questions.length - 1) {
      setAnswers(completedAnswers);
      setQuestionIndex((index) => index + 1);
      return;
    }
    setAnswers(completedAnswers);
    setResult(buildQuestionnaireResult(intake, completedAnswers));
    setStage('result');
  }

  function restart() {
    setStage('intro');
    setComplaint('');
    setIntake(null);
    setQuestionIndex(0);
    setAnswers({});
    setResult(null);
    setError(undefined);
  }

  return (
    <section className="card nv-questionnaire-card" aria-label="AI health questionnaire">
      <div className="nv-questionnaire-progress"><span style={{ width: `${progress}%` }} /></div>

      {stage === 'intro' ? (
        <form className="nv-questionnaire-intro" onSubmit={start}>
          <p className="eyebrow">AI health questionnaire</p>
          <h2>Tell us what you are feeling before you book</h2>
          <p className="muted">Gemini helps turn your first symptom description into a short structured intake survey. This is not a diagnosis.</p>
          <label className="nv-field">
            Main symptom
            <textarea
              value={complaint}
              maxLength={300}
              onChange={(event) => setComplaint(event.target.value)}
              placeholder="For example: I hurt my knee today and it is painful to walk."
            />
          </label>
          <div className="nv-questionnaire-examples">
            {['I have a bad headache', 'My chest feels tight', 'I hurt my ankle today'].map((example) => (
              <button key={example} type="button" onClick={() => setComplaint(example)}>{example}</button>
            ))}
          </div>
          {error ? <p className="nv-error" role="alert">{error}</p> : null}
          <button className="primary-btn" type="submit" disabled={loading || complaint.trim().length < 4}>
            {loading ? 'Preparing questionnaire' : isAuthenticated ? 'Start questionnaire' : 'Sign in to start'}
          </button>
        </form>
      ) : null}

      {stage === 'questions' && intake && question ? (
        <div className="nv-questionnaire-step">
          <div className="nv-questionnaire-meta">
            <button className="secondary-btn" type="button" onClick={() => questionIndex === 0 ? setStage('intro') : setQuestionIndex((index) => index - 1)}>Back</button>
            <div>
              <p className="eyebrow">{intake.pathwayName}</p>
              <span className="muted small">Question {questionIndex + 1} of {intake.questions.length}</span>
            </div>
          </div>
          <h2>{question.text}</h2>
          {question.helper ? <p className="muted">{question.helper}</p> : null}
          <QuestionControl question={question} value={answers[question.id]} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} />
          <button className="primary-btn" type="button" disabled={!canContinue} onClick={nextQuestion}>
            {questionIndex === intake.questions.length - 1 ? 'See recommendation' : 'Continue'}
          </button>
        </div>
      ) : null}

      {stage === 'result' && intake && result ? (
        <div className="nv-questionnaire-result">
          <p className="eyebrow">Recommended next step</p>
          <h2>{result.department}</h2>
          <p className="muted">{result.reason}</p>
          <div className={`nv-urgency-card urgency-${result.urgency}`}>
            <strong>{urgencyText(result.urgency).label}</strong>
            <span>{urgencyText(result.urgency).detail}</span>
          </div>
          {result.redFlags.length > 0 ? (
            <div className="nv-red-flags">
              <strong>Warning signs reported</strong>
              {result.redFlags.map((flag) => <span key={flag}>{flag}</span>)}
            </div>
          ) : null}
          <div className="nv-questionnaire-summary">
            <span>AI intake source: {intake.source === 'gemini' ? 'Gemini' : 'Local fallback'}</span>
            <span>Pathway: {intake.pathwayName}</span>
          </div>
          <div className="nv-recommended-care">
            <div>
              <strong>Recommended hospitals for this service</strong>
              <p className="muted small">These facilities have services that best match the questionnaire result.</p>
            </div>
            {recommendations.length > 0 ? (
              <div className="nv-recommended-list">
                {recommendations.map((hospital) => {
                  const services = matchingServices(hospital, intake, result.department);
                  const selectedService = services[0];
                  return (
                    <article className="nv-recommended-hospital" key={hospital.id}>
                      <div>
                        <strong>{hospital.name}</strong>
                        <span>{hospital.address}</span>
                      </div>
                      <div className="nv-service-tags">
                        {services.map((service) => <span className="nv-tag" key={`${hospital.id}-${service.id}`}>{service.name}</span>)}
                      </div>
                      {selectedService && resultSummary ? (
                        <button className="secondary-btn" type="button" onClick={() => onBookAppointment({ hospitalId: hospital.id, serviceId: selectedService.id, triageSummary: resultSummary })}>Book here</button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No hospital service data is loaded yet. Open booking to refresh available facilities.</p>
            )}
          </div>
          <div className="nv-questionnaire-actions">
            {resultSummary ? <button className="primary-btn" type="button" onClick={() => onBookAppointment({ triageSummary: resultSummary })}>Book at a recommended hospital</button> : null}
            <button className="secondary-btn" type="button" onClick={restart}>Start again</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
