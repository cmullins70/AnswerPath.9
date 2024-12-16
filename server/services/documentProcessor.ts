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
      console.log("Initializing OpenAI services...");
      
      this.openai = new ChatOpenAI({
        modelName: "gpt-3.5-turbo",
        temperature: 0,
        maxTokens: 2000,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });

      this.embeddings = new OpenAIEmbeddings({
        modelName: "text-embedding-ada-002",
        stripNewLines: true,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });
      
      console.log("Successfully initialized OpenAI services");
    } catch (error) {
      console.error("Failed to initialize OpenAI services:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
      throw new Error("Failed to initialize AI services. Please check your API key configuration.");
    }
  }

  async processDocument(file: Express.Multer.File): Promise<Document[]> {
    console.log(`Starting to process document: ${file.originalname} (${file.mimetype})`);
    
    const tempDir = path.join(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, file.originalname);
    
    try {
      console.log("Writing file to temporary location...");
      await fs.writeFile(tempFilePath, file.buffer);
      let docs: Document[] = [];

      console.log("Extracting content based on file type...");
      switch (file.mimetype) {
        case "application/pdf":
          console.log("Processing PDF document...");
          const pdfLoader = new PDFLoader(tempFilePath);
          docs = await pdfLoader.load();
          console.log(`Extracted ${docs.length} pages from PDF`);
          break;

        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/msword":
          console.log("Processing Word document...");
          const docxResult = await mammoth.extractRawText({ path: tempFilePath });
          docs = [new Document({ pageContent: docxResult.value })];
          console.log("Successfully extracted Word document content");
          break;

        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.ms-excel":
          console.log("Processing Excel document...");
          const workbook = XLSX.read(await fs.readFile(tempFilePath));
          const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
          const loader = new CSVLoader(new Blob([csvContent]));
          docs = await loader.load();
          console.log("Successfully converted Excel to text content");
          break;

        default:
          throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      console.log("Splitting document into manageable chunks...");
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const splitDocs = await textSplitter.splitDocuments(docs);
      console.log(`Split into ${splitDocs.length} chunks`);

      console.log("Creating vector store from documents...");
      this.vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, this.embeddings);
      console.log("Successfully created vector store");

      return splitDocs;
    } catch (error) {
      console.error("Error processing document:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
      throw error;
    } finally {
      console.log("Cleaning up temporary files...");
      await fs.unlink(tempFilePath).catch((error) => {
        console.error("Error deleting temporary file:", error);
      });
    }
  }

  async extractQuestions(docs: Document[]): Promise<ProcessedQuestion[]> {
    if (!this.vectorStore) {
      throw new Error("Documents must be processed before extracting questions");
    }
    
    console.log("Starting question extraction process...");
    console.log(`Processing ${docs.length} document chunks`);

    const template = `You are an AI assistant analyzing RFI documents. Below is the content to analyze:

Content:
{text}

Instructions:
1. Extract explicit questions (direct queries marked with ? or numbered)
2. Identify implicit questions (requirements needing responses)
3. For each question found:
   - Clearly state the question
   - Note if it's explicit or implicit
   - Include relevant context
   - Provide a confidence score

Format your response as a JSON array with these fields:
[
  {
    "text": "What is the expected response time?",
    "type": "explicit",
    "confidence": 0.9,
    "answer": "Based on the requirements...",
    "sourceDocument": "Section 3.2: Response Requirements"
  }
]

Only respond with valid JSON, no additional text.`;

    const questionExtractionPrompt = PromptTemplate.fromTemplate(template);

    try {
      const questions: ProcessedQuestion[] = [];
      
      for (const doc of docs) {
        const preview = doc.pageContent.slice(0, 100).replace(/\n/g, ' ');
        console.log(`Processing chunk: "${preview}..."`);
        
        try {
          // Format the content and invoke the LLM
          const text = doc.pageContent.trim();
          console.log("Calling OpenAI with content length:", text.length);
          
          const formattedPrompt = await questionExtractionPrompt.format({ text });
          console.log("Formatted prompt:", formattedPrompt);
          
          const response = await this.openai.invoke(formattedPrompt);
          
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
