import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
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
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/msword": {
          console.log("Processing Word document...");
          const result = await mammoth.extractRawText({ path: tempFilePath });
          if (!result.value) {
            throw new Error("Failed to extract text from Word document");
          }
          docs = [new Document({ pageContent: result.value })];
          break;
        }
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.ms-excel": {
          console.log("Processing Excel document...");
          const workbook = XLSX.read(await fs.readFile(tempFilePath));
          const sheets = workbook.SheetNames;
          
          // Process all sheets and combine their content
          const allContent = sheets.map(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            return `Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
          }).join("\n\n");
          
          docs = [new Document({ pageContent: allContent })];
          break;
        }
        default:
          throw new Error(`Unsupported file type: ${file.mimetype}. Currently supporting only Word and Excel files.`);
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

    const template = new PromptTemplate({
      template: `You are an expert at analyzing RFI (Request for Information) documents for sales professionals.
Your task is to carefully extract and analyze questions and requirements from the following text:

{text}

Follow these rules to identify questions:
1. Explicit questions: Direct questions marked with ? or using question words (what, how, when, etc.)
2. Implicit requirements: Statements that need responses (e.g., "Vendor must...", "Describe your...", "Provide details about...")
3. Generate detailed, professional answers that:
   - Are specific and actionable
   - Include relevant technical details
   - Maintain a professional tone
   - Focus on value proposition and capabilities
   - Demonstrate understanding of business requirements

Return a JSON array with exactly this format (no other text):
[{
  "text": "the complete question or requirement text",
  "type": "explicit" | "implicit",
  "confidence": number between 0-1,
  "answer": "detailed professional answer that addresses the specific requirement",
  "sourceDocument": "relevant context where found"
}]`,
      inputVariables: ["text"]
    });
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
          const content = Array.isArray(response.content) 
            ? response.content[0].text 
            : response.content;
            
          console.log("Raw OpenAI response:", content);
          const parsed = JSON.parse(content) as ProcessedQuestion[];
          
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
