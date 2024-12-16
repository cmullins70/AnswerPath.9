import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "langchain/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import * as pdfParse from 'pdf-parse';
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
      throw new Error("OpenAI API key is not configured");
    }

    this.openai = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0,
      maxTokens: 2000,
    });

    this.embeddings = new OpenAIEmbeddings();
  }

  async processDocument(file: Express.Multer.File): Promise<Document[]> {
    console.log(`Processing document: ${file.originalname} (${file.mimetype})`);
    
    const tempDir = path.join(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, file.originalname);
    
    try {
      await fs.writeFile(tempFilePath, file.buffer);
      let docs: Document[] = [];

      switch (file.mimetype) {
        case "application/pdf": {
          const dataBuffer = await fs.readFile(tempFilePath);
          const pdfData = await pdfParse(dataBuffer);
          docs = [new Document({ pageContent: pdfData.text })];
          break;
        }
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/msword": {
          const result = await mammoth.extractRawText({ path: tempFilePath });
          docs = [new Document({ pageContent: result.value })];
          break;
        }
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.ms-excel": {
          const workbook = XLSX.read(await fs.readFile(tempFilePath));
          const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
          docs = [new Document({ pageContent: csvContent })];
          break;
        }
        default:
          throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const splitDocs = await textSplitter.splitDocuments(docs);
      console.log(`Split document into ${splitDocs.length} chunks`);
      
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        splitDocs,
        this.embeddings
      );

      return splitDocs;
    } catch (error) {
      console.error("Error processing document:", error);
      throw error;
    } finally {
      await fs.unlink(tempFilePath).catch(console.error);
    }
  }

  async extractQuestions(docs: Document[]): Promise<ProcessedQuestion[]> {
    if (!this.vectorStore) {
      throw new Error("Documents must be processed before extracting questions");
    }

    const template = `You are an expert at analyzing RFI documents. Your task is to extract questions and requirements from the following text:

{text}

Carefully identify:
1. Explicit questions (marked with ? or using question words like what, how, when)
2. Implicit requirements (statements that need responses like "Vendor must..." or "Describe your...")

Return a JSON array with exactly this format (no other text):
[{
  "text": "the complete question or requirement text",
  "type": "explicit" | "implicit",
  "confidence": number between 0-1,
  "answer": "detailed draft answer",
  "sourceDocument": "relevant context where found"
}]`;

    const prompt = PromptTemplate.fromTemplate(template);
    const questions: ProcessedQuestion[] = [];

    for (const doc of docs) {
      const text = doc.pageContent.trim();
      if (!text || text.length < 20) continue;

      try {
        const formattedPrompt = await prompt.format({ text });
        const response = await this.openai.invoke(formattedPrompt);
        
        if (!response.content) {
          console.log("Empty response from OpenAI");
          continue;
        }

        try {
          console.log("Raw OpenAI response:", response.content);
          const parsed = JSON.parse(response.content) as ProcessedQuestion[];
          
          if (!Array.isArray(parsed)) {
            console.log("Response is not an array:", parsed);
            continue;
          }

          const valid = parsed.filter(q => 
            typeof q.text === 'string' && q.text.length > 0 &&
            (q.type === 'explicit' || q.type === 'implicit') &&
            typeof q.confidence === 'number' &&
            q.confidence >= 0 && q.confidence <= 1 &&
            typeof q.answer === 'string' &&
            typeof q.sourceDocument === 'string'
          );

          console.log(`Extracted ${valid.length} valid questions from chunk`);
          questions.push(...valid);
        } catch (e) {
          console.error("Failed to parse OpenAI response:", e);
        }
      } catch (e) {
        console.error("Failed to process document chunk:", e);
      }
    }

    console.log(`Total questions extracted: ${questions.length}`);
    return questions;
  }
}
