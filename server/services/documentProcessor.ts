import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
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
  private openai: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MemoryVectorStore | null = null;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is not configured. Please provide a valid API key.");
    }

    try {
      this.openai = new ChatOpenAI({
        modelName: "gpt-3.5-turbo",
        temperature: 0,
        maxTokens: 2000
      });

      this.embeddings = new OpenAIEmbeddings({
        modelName: "text-embedding-ada-002",
        stripNewLines: true
      });
    } catch (error) {
      console.error("Failed to initialize OpenAI services:", error);
      throw new Error("Failed to initialize AI services. Please check your API key configuration.");
    }
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
          const workbook = XLSX.read(await fs.readFile(tempFilePath));
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

    const questionExtractionPrompt = PromptTemplate.fromTemplate(
      "You are an AI assistant helping to analyze RFI (Request for Information) documents.\n" +
      "Analyze the following document content and:\n" +
      "1. Identify explicit questions (direct queries marked with question marks or numbered questions)\n" +
      "2. Recognize implicit questions (information requests or requirements that need responses)\n" +
      "3. For each question:\n" +
      "   - Extract or formulate the question clearly\n" +
      "   - Determine if it's explicit or implicit\n" +
      "   - Note the relevant context from the document\n" +
      "   - Assign a confidence score (0.1-1.0) based on clarity and context availability\n\n" +
      "Format your response as a valid JSON array with this structure:\n" +
      "[\n" +
      "  {\n" +
      '    "text": "<question text>",\n' +
      '    "type": "<explicit or implicit>",\n' +
      '    "confidence": <score between 0.1 and 1.0>,\n' +
      '    "answer": "<preliminary answer>",\n' +
      '    "sourceDocument": "<relevant excerpt>"\n' +
      "  }\n" +
      "]\n\n" +
      "Document content to analyze: {input}"
    );

    const chain = RunnableSequence.from([
      questionExtractionPrompt,
      this.openai,
      new StringOutputParser(),
    ]);

    const questions: ProcessedQuestion[] = [];
    
    try {
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        console.log(`Processing document chunk ${i + 1}/${docs.length}`);
        
        const response = await chain.invoke(doc.pageContent);
        try {
          const chunkQuestions = JSON.parse(response) as ProcessedQuestion[];
          questions.push(...chunkQuestions);
        } catch (parseError) {
          console.error("Failed to parse questions from chunk:", parseError);
          continue;
        }
      }

      return questions;
    } catch (error) {
      console.error("Failed to process questions:", error);
      throw error;
    }
  }
}
