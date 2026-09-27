export type PatientLanguage = 'en' | 'zu' | 'xh' | 'af' | 'nso' | 'st' | 'tn' | 'ss' | 've' | 'ts' | 'nr';

export interface PatientLanguageOption {
  code: PatientLanguage;
  label: string;
}

export const patientLanguages: readonly PatientLanguageOption[] = [
  { code: 'en', label: "English" },
  { code: 'zu', label: "isiZulu" },
  { code: 'xh', label: "isiXhosa" },
  { code: 'af', label: "Afrikaans" },
  { code: 'nso', label: "Sepedi" },
  { code: 'st', label: "Sesotho" },
  { code: 'tn', label: "Setswana" },
  { code: 'ss', label: "siSwati" },
  { code: 've', label: "Tshivenda" },
  { code: 'ts', label: "Xitsonga" },
  { code: 'nr', label: "isiNdebele" },
];
