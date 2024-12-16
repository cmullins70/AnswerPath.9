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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key is not configured");
    }

    this.openai = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.3,
      maxTokens: 2000,
      openAIApiKey: apiKey,
    });

    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
    });
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

    const prompt = PromptTemplate.fromTemplate(
      "You are an expert at analyzing RFI (Request for Information) documents for sales professionals. " +
      "Your task is to carefully extract and analyze questions and requirements from the following text:\n\n" +
      "{text}\n\n" +
      "Follow these rules to identify questions:\n" +
      "1. Explicit questions: Direct questions marked with ? or using question words (what, how, when, etc.)\n" +
      "2. Implicit requirements: Statements that need responses (e.g., 'Vendor must...', 'Describe your...', 'Provide details about...')\n" +
      "3. Generate detailed, professional answers that:\n" +
      "   - Are specific and actionable\n" +
      "   - Include relevant technical details\n" +
      "   - Maintain a professional tone\n" +
      "   - Focus on value proposition and capabilities\n" +
      "   - Demonstrate understanding of business requirements\n\n" +
      "Return a JSON array with exactly this format (no other text):\n" +
      '[{\n' +
      '  "text": "the complete question or requirement text",\n' +
      '  "type": "explicit" | "implicit",\n' +
      '  "confidence": number between 0-1,\n' +
      '  "answer": "detailed professional answer that addresses the specific requirement",\n' +
      '  "sourceDocument": "relevant context where found"\n' +
      '}]'
    );
    const questions: ProcessedQuestion[] = [];

    for (const doc of docs) {
      const text = doc.pageContent.trim();
      if (!text || text.length < 20) continue;

      try {
        console.log("Processing document chunk:", text.substring(0, 100) + "...");
        
        const formattedPrompt = await prompt.format({ text });
        console.log("Sending formatted prompt to OpenAI");
        
        const response = await this.openai.invoke(formattedPrompt);
        console.log("Received response from OpenAI");
        
        if (!response.content) {
          console.log("Empty response from OpenAI");
          continue;
        }

        try {
          // Handle different response content types
          let contentStr = "";
          if (typeof response.content === "string") {
            contentStr = response.content;
          } else if (Array.isArray(response.content)) {
            contentStr = response.content[0].text;
          } else if (typeof response.content === "object" && "text" in response.content) {
            contentStr = response.content.text;
          }
          
          console.log("Formatted response content:", contentStr);
          
          if (!contentStr) {
            console.log("No valid content in response");
            continue;
          }

          const parsed = JSON.parse(contentStr) as ProcessedQuestion[];
          console.log("Successfully parsed JSON response");
          
          if (!Array.isArray(parsed)) {
            console.log("Response is not an array:", parsed);
            continue;
          }

          const valid = parsed.filter(q => {
            const isValid = 
              typeof q.text === 'string' && q.text.length > 0 &&
              (q.type === 'explicit' || q.type === 'implicit') &&
              typeof q.confidence === 'number' &&
              q.confidence >= 0 && q.confidence <= 1 &&
              typeof q.answer === 'string' &&
              typeof q.sourceDocument === 'string';
            
            if (!isValid) {
              console.log("Invalid question object:", q);
            }
            
            return isValid;
          });

          console.log(`Extracted ${valid.length} valid questions from chunk`);
          questions.push(...valid);
        } catch (e) {
          console.error("Failed to parse OpenAI response:", e);
          if (e instanceof Error) {
            console.error("Error details:", e.message);
            console.error("Stack trace:", e.stack);
          }
        }
      } catch (e) {
        console.error("Failed to process document chunk:", e);
      }
    }

    console.log(`Total questions extracted: ${questions.length}`);
    return questions;
  }
}
