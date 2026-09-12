export type Paper = {
  id: string;
  title: string;
  filename: string;
  source: string;
  pages: number;
  currentPage: number;
  status: 'reading' | 'queued' | 'read';
  createdAt: string;
  updatedAt: string;
};
export type Action =
  'explain' | 'chat' | 'orientation' | 'prerequisites' | 'next' | 'quiz' | 'feedback';
export type Message = {
  id: string;
  paperId: string;
  role: 'user' | 'assistant';
  content: string;
  action: Action;
  page: number;
  endPage?: number;
  selection: string;
  createdAt: string;
  quizSuggested: boolean;
  quizDismissed: boolean;
  quizReason: string;
  generation?: GenerationSettings;
};
export type Signal = {
  id: string;
  concept: string;
  assessment: string;
  evidence: string;
  confidence: 'tentative' | 'supported';
  paperId: string;
  messageId: string;
  createdAt: string;
  source: 'tutor' | 'you';
};
export type Recommendation = {
  id: string;
  paperId: string;
  title: string;
  url: string;
  reason: string;
  kind: 'prerequisite' | 'next' | 'background';
  effort: string;
  status: 'suggested' | 'queued' | 'skipped' | 'read';
  position: number;
};
export type ReplyLength = 'concise' | 'balanced' | 'detailed';
export const defaultReplyStyle = {
  replyLength: 'concise' as ReplyLength,
  replyInstructions:
    'Write like a thoughtful person in a conversation. Use plain language, short paragraphs, and direct answers. Skip preambles, repeated summaries, and unnecessary headings.',
};
export type Profile = {
  background: string;
  goals: string;
  preferences: string;
  replyLength: ReplyLength;
  replyInstructions: string;
  signals: Signal[];
};
export type Passage = { text: string; page: number; endPage: number };
export type QuestionContext = { selection: string; page: number; endPage?: number };
export function pageLabel(page: number, endPage = page) {
  return endPage > page ? `pp. ${page}–${endPage}` : `p. ${page}`;
}
export type PaperDetail = {
  paper: Paper;
  messages: Message[];
  recommendations: Recommendation[];
  pageText: string;
  contextNotice: string;
};
export type AgentStatus = {
  available: boolean;
  authenticated: boolean;
  name: string;
  detail: string;
};
export type GenerationSettings = { model: string; effort: string };
export type ModelOption = {
  id: string;
  name: string;
  efforts: { id: string; description: string }[];
  defaultEffort: string;
  supportsImages: boolean;
};
export type ModelCatalog = { models: ModelOption[]; defaultModel: string };
export type GenerationOptions = ModelCatalog & { settings: GenerationSettings };
export type Job = {
  id: string;
  paperId: string;
  status: 'running' | 'complete' | 'failed';
  error: string;
  createdAt: string;
  finishedAt?: string;
};
export type TutorResult = {
  answer: string;
  quizSuggested: boolean;
  quizReason: string;
  signals: {
    concept: string;
    assessment: string;
    evidence: string;
    confidence: 'tentative' | 'supported';
  }[];
  recommendations: {
    title: string;
    url: string;
    reason: string;
    kind: 'prerequisite' | 'next' | 'background';
    effort: string;
  }[];
};
