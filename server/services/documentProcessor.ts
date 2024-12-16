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
    
    console.log("Starting question extraction process...");
    console.log(`Processing ${docs.length} document chunks`);

    const questionExtractionPrompt = PromptTemplate.fromTemplate(`
You are an AI assistant analyzing RFI documents. Below is the content to analyze:

Content:
{content}

Instructions:
1. Extract explicit questions (direct queries marked with ? or numbered)
2. Identify implicit questions (requirements needing responses)
3. For each question found:
   - Clearly state the question
   - Note if it's explicit or implicit
   - Include relevant context
   - Provide a confidence score

Format each question as a JSON object in an array with these fields:
- text: the question text
- type: "explicit" or "implicit"
- confidence: number between 0.1 and 1.0
- answer: brief preliminary answer
- sourceDocument: relevant context from the document

Response Format:
[
  {
    "text": "<question text>",
    "type": "<explicit or implicit>",
    "confidence": <number>,
    "answer": "<preliminary answer>",
    "sourceDocument": "<relevant context>"
  }
]
`);

    const chain = RunnableSequence.from([
      {
        content: (doc: Document) => doc.pageContent,
      },
      questionExtractionPrompt,
      this.openai,
      new StringOutputParser(),
    ]);

    const questions: ProcessedQuestion[] = [];
    
    try {
      for (const doc of docs) {
        const preview = doc.pageContent.slice(0, 100).replace(/\n/g, ' ');
        console.log(`Processing chunk: "${preview}..."`);
        
        try {
          console.log("Invoking LLM chain...");
          const response = await chain.invoke(doc);
          console.log("Raw LLM response:", response);
          
          let chunkQuestions: ProcessedQuestion[];
          try {
            chunkQuestions = JSON.parse(response) as ProcessedQuestion[];
            console.log(`Successfully parsed ${chunkQuestions.length} questions`);
          } catch (parseError) {
            console.error("Failed to parse LLM response as JSON:", parseError);
            console.error("Raw response was:", response);
            continue;
          }
          
          if (chunkQuestions && Array.isArray(chunkQuestions)) {
            questions.push(...chunkQuestions);
            console.log(`Added ${chunkQuestions.length} questions to results`);
          } else {
            console.error("Parsed response is not an array:", chunkQuestions);
          }
        } catch (chainError) {
          console.error("Chain execution failed:", chainError);
          if (chainError instanceof Error) {
            console.error("Error details:", chainError.message);
          }
          continue;
        }
      }

      if (questions.length === 0) {
        console.warn("No questions were extracted from any chunks");
      }

      return questions;
    } catch (error) {
      console.error("Failed to process questions:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
      throw error;
    }
  }
}
