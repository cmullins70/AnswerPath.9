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
      template: `Analyze this RFI document text and extract questions and requirements:

{text}

Respond with a JSON array where each item has these fields:
- text (the question or requirement)
- type (must be "explicit" or "implicit")
- confidence (a number between 0 and 1)
- answer (a detailed response)
- sourceDocument (where it was found)

Return only a properly formatted JSON array.`,
      inputVariables: ["text"]
    });

    console.log("Created prompt template");

    const questions: ProcessedQuestion[] = [];

    for (const doc of docs) {
      const text = doc.pageContent.trim();
      if (!text || text.length < 20) {
        console.log("Skipping short text chunk");
        continue;
      }

      try {
        console.log("Processing document chunk:", text.substring(0, 100) + "...");
        
        console.log("Formatting prompt with text length:", text.length);
        const formattedPrompt = await prompt.format({ text });
        console.log("Successfully formatted prompt");
        
        console.log("Calling OpenAI with formatted prompt");
        const response = await this.openai.invoke(formattedPrompt);
        console.log("Received response from OpenAI");
        
        if (!response.content) {
          console.log("Empty response content from OpenAI");
          continue;
        }

        // Extract and parse the response
        try {
          console.log("Raw response content:", response.content);
          
          let contentStr = typeof response.content === 'string' 
            ? response.content 
            : JSON.stringify(response.content);

          // Try to extract JSON array if content contains other text
          const jsonMatch = contentStr.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            contentStr = jsonMatch[0];
            console.log("Extracted JSON array from response:", contentStr);
          }

          let parsed: ProcessedQuestion[];
          try {
            parsed = JSON.parse(contentStr);
            console.log("Successfully parsed JSON:", parsed);
          } catch (parseError) {
            console.error("Failed to parse JSON:", parseError);
            console.log("Content that failed to parse:", contentStr);
            continue;
          }

          if (!Array.isArray(parsed)) {
            console.log("Parsed result is not an array, got:", typeof parsed);
            continue;
          }

          const valid = parsed.filter(q => {
            const validationErrors = [];
            
            if (!q.text || typeof q.text !== 'string' || q.text.length === 0) {
              validationErrors.push("Invalid or missing text");
            }
            if (q.type !== 'explicit' && q.type !== 'implicit') {
              validationErrors.push(`Invalid type: ${q.type}`);
            }
            if (typeof q.confidence !== 'number' || q.confidence < 0 || q.confidence > 1) {
              validationErrors.push(`Invalid confidence: ${q.confidence}`);
            }
            if (!q.answer || typeof q.answer !== 'string') {
              validationErrors.push("Invalid or missing answer");
            }
            if (!q.sourceDocument || typeof q.sourceDocument !== 'string') {
              validationErrors.push("Invalid or missing sourceDocument");
            }

            const isValid = validationErrors.length === 0;
            if (!isValid) {
              console.log("Validation errors for question:", {
                question: q,
                errors: validationErrors
              });
            } else {
              console.log("Valid question found:", q);
            }
            
            return isValid;
          });

          console.log(`Extracted ${valid.length} valid questions from chunk`);
          questions.push(...valid);
        } catch (error) {
          console.error("Failed to parse response:", error);
        }
      } catch (error) {
        console.error("Failed to process chunk:", error);
      }
    }

    console.log(`Total questions extracted: ${questions.length}`);
    return questions;
  }
}
