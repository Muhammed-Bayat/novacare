import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppointmentTriageSummary, Hospital, QuestionnaireAnswer, QuestionnaireAssessment, QuestionnaireIntake, QuestionnaireInterpretation } from '../../api.ts';
import { IntakeRecommendation } from './IntakeRecommendation.tsx';

type ChatStage = 'intro' | 'chat' | 'result';
type QuestionInterpretationStatus = 'idle' | 'loading' | 'success' | 'failed';

interface ChatMessage {
  role: 'ai' | 'patient';
  text: string;
  questionId?: string;
  kind?: 'acknowledgement';
}

export function IntakeChat({
  isAuthenticated,
  hospitals,
  onSignIn,
  onStartIntake,
  onCompleteQuestionnaire,
  onInterpretQuestionnaire,
  onBookAppointment,
}: {
  isAuthenticated: boolean;
  hospitals: Hospital[];
  onSignIn: () => void;
  onStartIntake: (complaint: string) => Promise<QuestionnaireIntake>;
  onCompleteQuestionnaire: (pathwayId: string, answers: QuestionnaireAnswer[]) => Promise<QuestionnaireAssessment>;
  onInterpretQuestionnaire: (pathwayId: string, questionId: string, message: string) => Promise<QuestionnaireInterpretation>;
  onBookAppointment: (input: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary }) => void;
}) {
  const [stage, setStage] = useState<ChatStage>('intro');
  const [complaint, setComplaint] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [intake, setIntake] = useState<QuestionnaireIntake>();
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);
  const [freeTextAnswer, setFreeTextAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [questionInterpretationStatus, setQuestionInterpretationStatus] = useState<QuestionInterpretationStatus>('idle');
  const [error, setError] = useState<string>();
  const [conclusion, setConclusion] = useState<{ source: QuestionnaireIntake['source']; fallbackReason?: QuestionnaireIntake['fallbackReason']; assessment: QuestionnaireAssessment }>();
  const messagesRef = useRef<HTMLDivElement>(null);
  const interpretationRequestRef = useRef(0);
  const autoScrolledQuestionRef = useRef<string>();
  const currentQuestion = intake?.questions[answers.length];

  useEffect(() => {
    const node = messagesRef.current;
    const questionId = currentQuestion?.id;
    if (!node || !questionId || autoScrolledQuestionRef.current === questionId) return;
    const activeQuestion = node.querySelector<HTMLElement>('[data-current-question="true"]');
    if (!activeQuestion) return;
    if (node.clientHeight === 0) {
      autoScrolledQuestionRef.current = questionId;
      return;
    }
    const inset = 12;
    const top = activeQuestion.offsetTop;
    const bottom = top + activeQuestion.offsetHeight;
    const visibleTop = node.scrollTop + inset;
    const visibleBottom = node.scrollTop + node.clientHeight - inset;
    if (top < visibleTop || bottom > visibleBottom) {
      node.scrollTo?.({ top: Math.max(0, top - inset), behavior: 'smooth' });
    }
    autoScrolledQuestionRef.current = questionId;
  }, [currentQuestion?.id]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      onSignIn();
      return;
    }
    if (complaint.trim().length < 4) return;
    setBusy(true);
    setError(undefined);
    setMessages([]);
    setIntake(undefined);
    setAnswers([]);
    setFreeTextAnswer('');
    interpretationRequestRef.current += 1;
    setQuestionInterpretationStatus('idle');
    autoScrolledQuestionRef.current = undefined;
    setConclusion(undefined);
    try {
      const nextIntake = await onStartIntake(complaint.trim());
      if (nextIntake.questions.length === 0) throw new Error('The standard intake questionnaire is unavailable. Please try again.');
      setIntake(nextIntake);
      setMessages([{ role: 'ai', text: nextIntake.questions[0].text, questionId: nextIntake.questions[0].id }]);
      setStage('chat');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function recordAnswer(display: string, value: QuestionnaireAnswer['value'], interpretationMessage?: string) {
    if (!intake || !currentQuestion) return;
    const nextAnswers = [...answers, { questionId: currentQuestion.id, value }];
    setError(undefined);
    setQuestionInterpretationStatus('idle');
    const answeredMessages: ChatMessage[] = [
      { role: 'patient', text: display },
      ...(interpretationMessage ? [{ role: 'ai' as const, text: interpretationMessage, kind: 'acknowledgement' as const }] : []),
    ];
    if (nextAnswers.length < intake.questions.length) {
      const nextQuestion = intake.questions[nextAnswers.length]!;
      setMessages((current) => [...current, ...answeredMessages, { role: 'ai', text: nextQuestion.text, questionId: nextQuestion.id }]);
      setAnswers(nextAnswers);
      return;
    }
    setMessages((current) => [...current, ...answeredMessages]);
    setBusy(true);
    try {
      const assessment = await onCompleteQuestionnaire(intake.pathwayId, nextAnswers);
      setAnswers(nextAnswers);
      setConclusion({ source: intake.source, fallbackReason: intake.fallbackReason, assessment });
      setStage('result');
    } catch (answerError) {
      setMessages((current) => current.slice(0, -answeredMessages.length));
      setError(answerError instanceof Error ? answerError.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(display: string, value: QuestionnaireAnswer['value']) {
    if (busy) return;
    interpretationRequestRef.current += 1;
    setQuestionInterpretationStatus('idle');
    setFreeTextAnswer('');
    await recordAnswer(display, value);
  }

  async function submitFreeText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intake || !currentQuestion || !currentQuestion.options?.length || busy || questionInterpretationStatus === 'loading' || !freeTextAnswer.trim()) return;
    const message = freeTextAnswer.trim();
    const requestId = interpretationRequestRef.current + 1;
    interpretationRequestRef.current = requestId;
    setQuestionInterpretationStatus('loading');
    setError(undefined);
    try {
      const interpretation = await onInterpretQuestionnaire(intake.pathwayId, currentQuestion.id, message);
      if (requestId !== interpretationRequestRef.current) return;
      setFreeTextAnswer('');
      setQuestionInterpretationStatus(interpretation.interpretationStatus === 'failed' ? 'failed' : 'success');
      if (interpretation.type === 'answer' && interpretation.answerId) {
        const option = currentQuestion.options.find((item) => item.id === interpretation.answerId);
        if (option) {
          await recordAnswer(message, option.value, interpretation.message);
          return;
        }
      }
      setMessages((current) => [...current, { role: 'patient', text: message }, { role: 'ai', text: interpretation.message }]);
    } catch {
      if (requestId !== interpretationRequestRef.current) return;
      setQuestionInterpretationStatus('failed');
      setMessages((current) => [...current, { role: 'patient', text: message }, { role: 'ai', text: "I couldn't interpret that automatically. Please choose the option that best matches your answer." }]);
    }
  }

  function restart() {
    setStage('intro');
    setComplaint('');
    setMessages([]);
    setIntake(undefined);
    setAnswers([]);
    setFreeTextAnswer('');
    interpretationRequestRef.current += 1;
    autoScrolledQuestionRef.current = undefined;
    setQuestionInterpretationStatus('idle');
    setError(undefined);
    setConclusion(undefined);
  }

  return (
    <section className="card nv-questionnaire-card" aria-label="AI-assisted intake">
      {stage === 'intro' ? (
        <form className="nv-questionnaire-intro" onSubmit={start}>
          <p className="eyebrow">AI-assisted intake</p>
          <h2>Tell us what you are feeling before you book</h2>
          <p className="muted">Your initial message selects a standard intake questionnaire. You can also describe an answer in your own words or ask what a question means. The questions and assessment are not generated by AI. This is not a diagnosis.</p>
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
          <button className="primary-btn" type="submit" disabled={busy || complaint.trim().length < 4}>
            {busy ? 'Starting…' : isAuthenticated ? 'Start assessment' : 'Sign in to start'}
          </button>
        </form>
      ) : null}

      {stage === 'chat' ? (
        <div className="nv-chat">
          <div className="nv-chat-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`nv-chat-bubble ${message.role}${message.questionId ? ' question' : ''}${message.kind === 'acknowledgement' ? ' acknowledgement' : ''}`}
                data-current-question={message.questionId === currentQuestion?.id ? 'true' : undefined}
              >
                {message.text}
              </div>
            ))}
              {busy || questionInterpretationStatus === 'loading' ? <div className="nv-chat-bubble ai nv-chat-typing">{questionInterpretationStatus === 'loading' ? 'Interpreting…' : 'Assessing…'}</div> : null}
            </div>
            {currentQuestion && !busy ? (
              <div className="nv-chat-reply">
                {currentQuestion.type === 'yes-no' ? (
                  <div className="nv-questionnaire-options">
                    <button type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer('Yes', true)}>Yes</button>
                    <button type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer('No', false)}>No</button>
                  </div>
                ) : null}
                {currentQuestion.type === 'single' ? (
                  <div className="nv-questionnaire-options">
                    {currentQuestion.options?.map((option) => (
                      <button key={option.id} type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer(option.label, option.value)}>
                        {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {currentQuestion.type === 'scale' ? (
                <div className="nv-chat-scale">
                  <span className="muted small">0 = none · 10 = worst</span>
                  <div className="nv-chat-scale-options">
                    {Array.from({ length: 11 }, (_, value) => (
                      <button key={value} type="button" className="nv-chat-scale-chip" onClick={() => void submitAnswer(`${value}/10`, value)}>{value}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {currentQuestion.options?.length ? (
                <>
                  <p className="muted small">Or tell us in your own words</p>
                  <form className="nv-chat-text-row" onSubmit={(event) => void submitFreeText(event)}>
                    <input
                      id={`question-answer-${currentQuestion.id}`}
                      aria-label="Tell us in your own words"
                      value={freeTextAnswer}
                      onChange={(event) => setFreeTextAnswer(event.target.value)}
                      placeholder="Describe your answer…"
                      maxLength={500}
                    />
                    <button className="secondary-btn" type="submit" disabled={questionInterpretationStatus === 'loading' || !freeTextAnswer.trim()}>Send</button>
                  </form>
                </>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="nv-error" role="alert">{error}</p> : null}
          <p className="muted small">AI can select the standard questionnaire and help interpret a typed response. A nurse reviews everything before you are placed in a queue.</p>
        </div>
      ) : null}

      {stage === 'result' && conclusion ? (
        <IntakeRecommendation
          hospitals={hospitals}
          pathwayName={conclusion.assessment.pathwayName}
          source={conclusion.source}
          fallbackReason={conclusion.fallbackReason}
          urgency={conclusion.assessment.urgency}
          department={conclusion.assessment.department}
          reason={conclusion.assessment.summary}
          redFlags={conclusion.assessment.redFlags}
          onBookAppointment={onBookAppointment}
          onRestart={restart}
        />
      ) : null}
    </section>
  );
}
