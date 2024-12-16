export type DocumentType = {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  status: "processing" | "processed";
};

export type ProcessingStatusType = {
  currentStep: "preparation" | "extraction" | "questions" | "analysis" | "complete" | "error";
  completedSteps: string[];
  progress: number;
  error?: string;
};

export type QuestionType = {
  id: string;
  text: string;
  answer: string;
  confidence: number;
  sourceDocument: string;
  type: "explicit" | "implicit";
};
