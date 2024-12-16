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

    const questionExtractionPrompt = PromptTemplate.fromTemplate(
      "You are an AI assistant analyzing RFI documents. Below is the content to analyze:\n\n" +
      "Content:\n{content}\n\n" +
      "Instructions:\n" +
      "1. Extract explicit questions (direct queries marked with ? or numbered)\n" +
      "2. Identify implicit questions (requirements needing responses)\n" +
      "3. For each question found:\n" +
      "   - Clearly state the question\n" +
      "   - Note if it's explicit or implicit\n" +
      "   - Include relevant context\n" +
      "   - Provide a confidence score\n\n" +
      "Format your response as a JSON array with these fields:\n" +
      "[\n" +
      "  {\n" +
      '    "text": "<the question text>",\n' +
      '    "type": "explicit",\n' +
      '    "confidence": 0.9,\n' +
      '    "answer": "<answer text>",\n' +
      '    "sourceDocument": "<relevant context>"\n' +
      "  }\n" +
      "]\n\n" +
      "Only respond with valid JSON, no additional text."
    );

    try {
      const questions: ProcessedQuestion[] = [];
      
      for (const doc of docs) {
        const preview = doc.pageContent.slice(0, 100).replace(/\n/g, ' ');
        console.log(`Processing chunk: "${preview}..."`);
        
        try {
          // Format the content and invoke the LLM
          const content = doc.pageContent.trim();
          console.log("Calling OpenAI with content length:", content.length);
          
          const response = await this.openai.invoke(
            await questionExtractionPrompt.format({ content })
          );
          
          console.log("OpenAI Response:", response);
          
          // Parse the response text from the ChatMessage
          const responseText = response.content as string;
          console.log("Extracted response text:", responseText);
          
          let chunkQuestions: ProcessedQuestion[];
          try {
            chunkQuestions = JSON.parse(responseText) as ProcessedQuestion[];
            
            // Validate the parsed questions
            if (!Array.isArray(chunkQuestions)) {
              console.error("Parsed response is not an array:", chunkQuestions);
              continue;
            }
            
            // Validate each question object
            const validQuestions = chunkQuestions.filter(q => {
              return (
                typeof q.text === 'string' && q.text.length > 0 &&
                (q.type === 'explicit' || q.type === 'implicit') &&
                typeof q.confidence === 'number' &&
                q.confidence >= 0 && q.confidence <= 1 &&
                typeof q.answer === 'string' &&
                typeof q.sourceDocument === 'string'
              );
            });
            
            questions.push(...validQuestions);
            console.log(`Added ${validQuestions.length} valid questions from chunk`);
            
          } catch (parseError) {
            console.error("Failed to parse OpenAI response as JSON:", parseError);
            console.error("Raw response was:", responseText);
            continue;
          }
        } catch (error) {
          console.error("Error processing chunk:", error);
          if (error instanceof Error) {
            console.error("Error details:", error.message, error.stack);
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
