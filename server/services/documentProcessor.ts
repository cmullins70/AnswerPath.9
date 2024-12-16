import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/community/vectorstores/memory";
import { ChatOpenAI } from "@langchain/openai";
import { createRetrievalChain } from "langchain/chains/retrieval";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as fs from "fs/promises";
import * as path from "path";

export type ProcessedQuestion = {
  text: string;
  type: "explicit" | "implicit";
  confidence: number;
  answer: string;
  sourceDocument: string;
};

export class DocumentProcessor {
  private openai: OpenAI;
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MemoryVectorStore | null = null;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required");
    }

    this.openai = new ChatOpenAI({
      modelName: "gpt-4-1106-preview",
      temperature: 0.0,
      maxTokens: 4096
    });

    this.embeddings = new OpenAIEmbeddings({
      modelName: "text-embedding-3-small",
      stripNewLines: true,
      batchSize: 512
    });
  }

  async processDocument(file: Express.Multer.File): Promise<Document[]> {
    const tempDir = path.join(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, file.originalname);
    
    try {
      await fs.writeFile(tempFilePath, file.buffer);
      let docs: Document[] = [];

      switch (file.mimetype) {
        case "application/pdf":
          const pdfLoader = new PDFLoader(tempFilePath);
          docs = await pdfLoader.load();
          break;

        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/msword":
          const docxResult = await mammoth.extractRawText({ path: tempFilePath });
          docs = [new Document({ pageContent: docxResult.value })];
          break;

        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.ms-excel":
          const workbook = XLSX.readFile(tempFilePath);
          const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
          const loader = new CSVLoader(new Blob([csvContent]));
          docs = await loader.load();
          break;

        default:
          throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const splitDocs = await textSplitter.splitDocuments(docs);
      this.vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, this.embeddings);

      return splitDocs;
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }

  async extractQuestions(docs: Document[]): Promise<ProcessedQuestion[]> {
    if (!this.vectorStore) {
      throw new Error("Documents must be processed before extracting questions");
    }

    const chain = RetrievalQAChain.fromLLM(
      this.openai,
      this.vectorStore.asRetriever(),
    );

    const questionExtractionPrompt = `
    Analyze the following document and:
    1. Identify explicit questions (direct queries)
    2. Recognize implicit questions (implied information requests)
    3. For each question:
       - Determine if it's explicit or implicit
       - Generate a detailed answer
       - Assign a confidence score (0-1)

    Return the results in this format:
    [
      {
        "text": "the question",
        "type": "explicit" or "implicit",
        "confidence": 0.95,
        "answer": "detailed answer",
        "sourceDocument": "relevant section from source"
      }
    ]
    `;

    const combinedText = docs.map(doc => doc.pageContent).join("\n\n");
    const response = await this.openai.invoke(questionExtractionPrompt + "\n\nDocument:\n" + combinedText);
    
    try {
      const questions = JSON.parse(response);
      return questions as ProcessedQuestion[];
    } catch (error) {
      console.error("Failed to parse questions:", error);
      return [];
    }
  }
}
