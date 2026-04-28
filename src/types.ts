export type Modality = 'Texto' | 'Voz';

export interface SetupData {
  area: string;
  language: string;
  modality: Modality;
  professionalSummary?: string;
}

export interface Message {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  timestamp: number;
}

export interface EvaluationReport {
  nota_final: number;
  idioma_dominio: string;
  pros: string[];
  contras: string[];
  feedback_geral: string;
}
