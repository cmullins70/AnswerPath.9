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
          console.log("Extracted Word content:", result.value?.substring(0, 200));
          if (!result.value) {
            throw new Error("Failed to extract text from Word document");
          }
          docs = [new Document({ 
            pageContent: result.value,
            metadata: { source: file.originalname }
          })];
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
            const content = XLSX.utils.sheet_to_csv(sheet);
            console.log(`Excel sheet ${sheetName} content:`, content.substring(0, 200));
            return `Sheet: ${sheetName}\n${content}`;
          }).join("\n\n");
          
          docs = [new Document({ 
            pageContent: allContent,
            metadata: { source: file.originalname }
          })];
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

    const prompt = new PromptTemplate({
      template: `You are an expert at analyzing RFI documents. Analyze this text and extract questions:

{text}

Return only a JSON array with this structure (no other text):
[{
  "text": "extracted question",
  "type": "explicit",
  "confidence": 0.9,
  "answer": "professional answer",
  "sourceDocument": "source section"
}]`,
      inputVariables: ["text"]
    });
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
          const content = response.content;
          if (!content) {
            console.log("Empty response from OpenAI");
            continue;
          }

          // Extract the actual response content
          const contentStr = typeof content === 'string' 
            ? content 
            : JSON.stringify(content);

          console.log("Processing OpenAI response:", contentStr);

          // Try to find and parse the JSON array in the response
          let jsonStr = contentStr;
          const jsonMatch = contentStr.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            jsonStr = jsonMatch[0];
          }

          const parsed = JSON.parse(jsonStr) as ProcessedQuestion[];
          console.log("Successfully parsed JSON array:", parsed);

          if (!Array.isArray(parsed)) {
            console.log("Parsed result is not an array:", parsed);
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
