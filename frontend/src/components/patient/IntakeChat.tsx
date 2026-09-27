import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppointmentTriageSummary, Hospital, IntakeChatAnswer, IntakeChatConclusion, IntakeChatQuestion, IntakeChatTurn } from '../../api.ts';
import { IntakeRecommendation } from './IntakeRecommendation.tsx';

type ChatStage = 'intro' | 'chat' | 'result';

interface ChatMessage {
  role: 'ai' | 'patient';
  text: string;
}

export function IntakeChat({
  isAuthenticated,
  hospitals,
  onSignIn,
  onChatTurn,
  onBookAppointment,
}: {
  isAuthenticated: boolean;
  hospitals: Hospital[];
  onSignIn: () => void;
  onChatTurn: (complaint: string, answers: IntakeChatAnswer[]) => Promise<IntakeChatTurn>;
  onBookAppointment: (input: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary }) => void;
}) {
  const [stage, setStage] = useState<ChatStage>('intro');
  const [complaint, setComplaint] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<IntakeChatQuestion>();
  const [answers, setAnswers] = useState<IntakeChatAnswer[]>([]);
  const [textAnswer, setTextAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conclusion, setConclusion] = useState<{ source: 'gemini' | 'local'; intake: IntakeChatConclusion }>();
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function advance(activeComplaint: string, nextAnswers: IntakeChatAnswer[]) {
    const turn = await onChatTurn(activeComplaint, nextAnswers);
    if (turn.action === 'question') {
      setMessages((current) => [...current, { role: 'ai', text: turn.question.text }]);
      setCurrentQuestion(turn.question);
      setStage('chat');
      return;
    }
    setConclusion({ source: turn.source, intake: turn.intake });
    setCurrentQuestion(undefined);
    setStage('result');
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      onSignIn();
      return;
    }
    if (complaint.trim().length < 4) return;
    setBusy(true);
    setError(undefined);
    try {
      await advance(complaint.trim(), []);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(display: string, stored: string) {
    if (!currentQuestion || busy) return;
    const nextAnswers = [...answers, { question: currentQuestion.text, answer: stored }];
    setMessages((current) => [...current, { role: 'patient', text: display }]);
    setAnswers(nextAnswers);
    setCurrentQuestion(undefined);
    setTextAnswer('');
    setBusy(true);
    setError(undefined);
    try {
      await advance(complaint, nextAnswers);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStage('intro');
    setComplaint('');
    setMessages([]);
    setCurrentQuestion(undefined);
    setAnswers([]);
    setTextAnswer('');
    setError(undefined);
    setConclusion(undefined);
  }

  return (
    <section className="card nv-questionnaire-card" aria-label="AI triage chat">
      {stage === 'intro' ? (
        <form className="nv-questionnaire-intro" onSubmit={start}>
          <p className="eyebrow">AI triage chat</p>
          <h2>Tell us what you are feeling before you book</h2>
          <p className="muted">Have a short conversation with our AI intake assistant. It asks only the fewest questions needed to point you to the right service. This is not a diagnosis.</p>
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
            {busy ? 'Connecting…' : isAuthenticated ? 'Start conversation' : 'Sign in to start'}
          </button>
        </form>
      ) : null}

      {stage === 'chat' ? (
        <div className="nv-chat">
          <div className="nv-chat-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={`nv-chat-bubble ${message.role}`}>{message.text}</div>
            ))}
            {busy ? <div className="nv-chat-bubble ai nv-chat-typing">Typing…</div> : null}
          </div>
          {currentQuestion && !busy ? (
            <div className="nv-chat-reply">
              {currentQuestion.type === 'yes_no' ? (
                <div className="nv-questionnaire-options">
                  <button type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer('Yes', 'Yes')}>Yes</button>
                  <button type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer('No', 'No')}>No</button>
                </div>
              ) : null}
              {currentQuestion.type === 'single' ? (
                <div className="nv-questionnaire-options">
                  {currentQuestion.options?.map((option) => (
                    <button key={option.id} type="button" className="nv-questionnaire-option" onClick={() => void submitAnswer(option.label, option.label)}>
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
                      <button key={value} type="button" className="nv-chat-scale-chip" onClick={() => void submitAnswer(`${value}/10`, String(value))}>{value}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {currentQuestion.type === 'text' ? (
                <form className="nv-chat-text-row" onSubmit={(event) => { event.preventDefault(); if (textAnswer.trim()) void submitAnswer(textAnswer.trim(), textAnswer.trim()); }}>
                  <input value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} placeholder="Type your answer…" maxLength={300} />
                  <button className="primary-btn" type="submit" disabled={!textAnswer.trim()}>Send</button>
                </form>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="nv-error" role="alert">{error}</p> : null}
          <p className="muted small">This assistant does not diagnose or treat — a nurse reviews everything before you are placed in a queue.</p>
        </div>
      ) : null}

      {stage === 'result' && conclusion ? (
        <IntakeRecommendation
          hospitals={hospitals}
          pathwayName={conclusion.intake.pathwayName}
          source={conclusion.source}
          urgency={conclusion.intake.urgency}
          department={conclusion.intake.department}
          reason={conclusion.intake.summary}
          redFlags={conclusion.intake.redFlags}
          onBookAppointment={onBookAppointment}
          onRestart={restart}
        />
      ) : null}
    </section>
  );
}
