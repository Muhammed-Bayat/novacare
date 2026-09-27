export type UssdStep =
  | 'main_menu'
  | 'ambulance_conscious'
  | 'home_visit_practitioner'
  | 'reference_prompt'
  | 'confirmation'
  | 'invalid_selection';

export type UssdResponse = { step: UssdStep; message: string };

export const USSD_INVALID_REQUEST_MESSAGE = 'END NovaCare could not process this request. Please try again.';

const MAIN_MENU = 'CON Welcome to NovaCare\n1. Request an ambulance\n2. Request a home visit\n3. Check a request';
const AMBULANCE_MENU = 'CON Ambulance request\nIs the patient conscious?\n1. Yes\n2. No';
const HOME_VISIT_MENU = 'CON Home visit request\nPlease select:\n1. Doctor\n2. Nurse\n3. Either';
const REFERENCE_PROMPT = 'CON Enter your NovaCare request reference';
const CONFIRMATION = 'END Thank you. NovaCare received your test request successfully.';
const INVALID_SELECTION = 'END Invalid selection. Please try again.';

export function responseForText(text: string): UssdResponse {
  const input = text.trim();
  if (!input) return { step: 'main_menu', message: MAIN_MENU };

  const keys = input.split('*');
  const [first, second] = keys;

  if (first === '1') {
    if (keys.length === 1) return { step: 'ambulance_conscious', message: AMBULANCE_MENU };
    return second === '1' || second === '2'
      ? { step: 'confirmation', message: CONFIRMATION }
      : { step: 'invalid_selection', message: INVALID_SELECTION };
  }

  if (first === '2') {
    if (keys.length === 1) return { step: 'home_visit_practitioner', message: HOME_VISIT_MENU };
    return second === '1' || second === '2' || second === '3'
      ? { step: 'confirmation', message: CONFIRMATION }
      : { step: 'invalid_selection', message: INVALID_SELECTION };
  }

  if (first === '3') {
    if (keys.length === 1) return { step: 'reference_prompt', message: REFERENCE_PROMPT };
    return second?.trim()
      ? { step: 'confirmation', message: CONFIRMATION }
      : { step: 'invalid_selection', message: INVALID_SELECTION };
  }

  return { step: 'invalid_selection', message: INVALID_SELECTION };
}
