import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { db } from "@db";
import { documents, questions } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { DocumentProcessor } from "./services/documentProcessor";
import { WebScraper } from "./services/webScraper";
import { EmbeddingsService } from './services/embeddings';
import { contexts } from "@db/schema";

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    cb(null, allowedTypes.includes(file.mimetype));
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

const processor = new DocumentProcessor();
const webScraper = new WebScraper();
const embeddingsService = new EmbeddingsService();
const processingStatus = new Map<number, {
  currentStep: string;
  completedSteps: string[];
  progress: number;
  error?: string;
}>();

export function registerRoutes(app: Express) {
  app.post("/api/documents/upload", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const uploadedDocs = await Promise.all(
        files.map(async (file) => {
          const [doc] = await db.insert(documents).values({
            name: file.originalname,
            type: file.mimetype,
            content: file.buffer.toString('base64'),
            status: 'processing',
            metadata: {}
          }).returning();

          // Process document in background
          processDocument(doc.id, file).catch((error) => {
            console.error(`Error processing document ${doc.id}:`, error);
            if (error instanceof Error) {
              console.error("Full error details:", error.message, error.stack);
            }
          });

          return doc;
        })
      );
      res.json(uploadedDocs);
    } catch (error) {
      console.error("Upload failed:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.get("/api/documents", async (_req, res) => {
    try {
      const docs = await db.select().from(documents);
      res.json(docs);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid document ID" });
      }

      await db.delete(documents).where(eq(documents.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.get("/api/processing/status", async (req, res) => {
    const documentId = parseInt(req.query.documentId as string);
    if (isNaN(documentId)) {
      console.log("No document ID provided");
      return res.json({
        currentStep: "preparation",
        completedSteps: [],
        progress: 0
      });
    }
    
    console.log(`Fetching processing status for document ${documentId}`);
    const doc = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc.length) {
      console.log(`Document ${documentId} not found`);
      return res.status(404).json({ error: "Document not found" });
    }

    const status = processingStatus.get(documentId);
    console.log(`Current processing status for document ${documentId}:`, status);
    
    if (!status) {
      const defaultStatus = {
        currentStep: doc[0].status === "error" ? "error" : 
                    doc[0].status === "processed" ? "complete" : "preparation",
        completedSteps: doc[0].status === "processed" ? 
                       ["preparation", "extraction", "questions", "analysis"] : [],
        progress: doc[0].status === "error" ? 0 : 
                 doc[0].status === "processed" ? 100 : 25,
        error: doc[0].status === "error" ? 
               (doc[0].metadata as any)?.error || "Unknown error occurred" : undefined
      };
      console.log(`Using default status:`, defaultStatus);
      return res.json(defaultStatus);
    }

    res.json(status);
  });

  app.get("/api/questions", async (_req, res) => {
    try {
      const allQuestions = await db.select().from(questions);
      res.json(allQuestions);
    } catch (error) {
      console.error("Failed to fetch questions:", error);
      res.status(500).json({ error: "Failed to fetch questions" });
    }
  });

  app.get("/api/contexts", async (_req, res) => {
    try {
      console.log("Fetching all contexts");
      const allContexts = await db.select().from(contexts);
      console.log("Found contexts:", allContexts);
      res.json(allContexts);
    } catch (error) {
      console.error("Failed to fetch contexts:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      res.status(500).json({ 
        error: "Failed to fetch contexts",
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/contexts", async (req, res) => {
    try {
      const { title, content, type } = req.body;
      
      // Insert the context
      const [newContext] = await db.insert(contexts)
        .values({ title, content, type })
        .returning();

      // Generate and store embeddings for the content
      const sentences = content.split(/[.!?]+/).filter(Boolean).map(s => s.trim());
      
      // Process potential questions (sentences ending with ?)
      const questions = sentences.filter(s => s.endsWith('?'));
      for (const question of questions) {
        await embeddingsService.storeQuestionEmbedding(newContext.id, question);
      }
      
      // Process potential answers (sentences not ending with ?)
      const answers = sentences.filter(s => !s.endsWith('?'));
      for (const answer of answers) {
        await embeddingsService.storeAnswerEmbedding(newContext.id, answer);
      }

      res.json(newContext);
    } catch (error) {
      console.error("Error creating context:", error);
      res.status(500).json({ error: "Failed to create context" });
    }
  });

  app.delete("/api/contexts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid context ID" });
      }

      // Delete embeddings first
      await embeddingsService.deleteContextEmbeddings(id);

      // Then delete the context
      await db.delete(contexts).where(eq(contexts.id, id));
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting context:", error);
      res.status(500).json({ error: "Failed to delete context" });
    }
  });

  app.post("/api/contexts/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = req.file;
      console.log("Processing uploaded file:", file.originalname);

      // Extract text content from the file using DocumentProcessor
      const docs = await processor.processDocument(file);
      const content = docs.map(doc => doc.pageContent).join("\n\n");

      console.log("Creating context entry for document");
      const [context] = await db.insert(contexts).values({
        title: file.originalname,
        content,
        type: "document",
        metadata: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      console.log("Successfully created context:", context);
      res.json(context);
    } catch (error) {
      console.error("Failed to process uploaded document:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      res.status(500).json({ 
        error: "Failed to process document",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/contexts/scrape", async (req, res) => {
    try {
      console.log("Received scrape request:", req.body);
      const { url } = req.body;
      
      if (!url || !webScraper.validateUrl(url)) {
        console.log("Invalid URL provided:", url);
        return res.status(400).json({ error: "Invalid URL provided" });
      }

      console.log("Scraping website:", url);
      const { title, content } = await webScraper.scrapeWebsite(url);
      console.log("Successfully scraped website. Title:", title, "Content length:", content.length);

      console.log("Inserting context into database");
      const [context] = await db.insert(contexts).values({
        title,
        content,
        type: "website",
        metadata: { url },
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      console.log("Successfully created context:", context);
      res.json(context);
    } catch (error) {
      console.error("Failed to scrape website:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      res.status(500).json({ 
        error: "Failed to scrape website",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/questions/export", async (_req, res) => {
    console.log("Starting CSV export of all questions");
    try {
      const allQuestions = await db.select({
        text: questions.text,
        type: questions.type,
        confidence: questions.confidence,
        answer: questions.answer,
        sourceDocument: questions.sourceDocument,
      }).from(questions);

      if (allQuestions.length === 0) {
        console.log("No questions found to export");
        return res.status(404).json({ error: "No questions found to export" });
      }

      console.log(`Found ${allQuestions.length} questions to export`);
      let csvContent = 'Question,Type,Confidence,Answer,Source Document\n';

      for (const q of allQuestions) {
        try {
          const confidence = typeof q.confidence === 'number' && !isNaN(q.confidence) 
            ? (q.confidence * 100).toFixed(1) 
            : '0.0';

          const row = [
            q.text || '',
            q.type || 'unknown',
            `${confidence}%`,
            q.answer || '',
            q.sourceDocument || ''
          ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');

          csvContent += row + '\n';
        } catch (err) {
          console.error('Error processing row:', err, q);
          continue;
        }
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="questions.csv"');
      res.send(csvContent);

      console.log("Export completed successfully");
    } catch (error) {
      console.error("Export failed:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      res.status(500).json({ 
        error: "Failed to export questions",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/questions/:documentId", async (req, res) => {
    try {
      console.log(`Fetching questions for document ID: ${req.params.documentId}`);
      
      const documentId = parseInt(req.params.documentId);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: "Invalid document ID" });
      }

      const result = await db.execute(sql`
        SELECT 
          id,
          text,
          type,
          COALESCE(
            CASE WHEN confidence::text = 'NaN' THEN 0
            ELSE NULLIF(confidence, 'NaN')::float
            END,
            0
          ) as confidence,
          answer,
          source_document as "sourceDocument"
        FROM questions
        WHERE document_id = ${documentId}
        ORDER BY id ASC
      `);

      console.log(`Found ${result.length} questions for document ${documentId}`);
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch document questions:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      res.status(500).json({ 
        error: "Failed to fetch document questions",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/search/similar", async (req, res) => {
    try {
      const { query, type = 'both', limit = 5 } = req.body;
      
      const results: {
        questions?: Array<{ questionText: string; similarity: number }>;
        answers?: Array<{ answerText: string; similarity: number }>;
      } = {};

      if (type === 'questions' || type === 'both') {
        results.questions = await embeddingsService.findSimilarQuestions(query, limit);
      }

      if (type === 'answers' || type === 'both') {
        results.answers = await embeddingsService.findSimilarAnswers(query, limit);
      }

      res.json(results);
    } catch (error) {
      console.error("Error searching similar content:", error);
      res.status(500).json({ error: "Failed to search similar content" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function processDocument(documentId: number, file: Express.Multer.File) {
  try {
    console.log(`Starting processing for document ${documentId}`);
    console.log(`File details: name=${file.originalname}, type=${file.mimetype}, size=${file.size} bytes`);
    
    // Initialize processing status
    processingStatus.set(documentId, {
      currentStep: "preparation",
      completedSteps: [],
      progress: 0
    });

    try {
      // Initial preparation step
      console.log("Starting document preparation...");
      processingStatus.set(documentId, {
        currentStep: "preparation",
        completedSteps: [],
        progress: 0
      });
      
      // Extract content
      console.log("Extracting document content...");
      processingStatus.set(documentId, {
        currentStep: "extraction",
        completedSteps: ["preparation"],
        progress: 25
      });
      
      const docs = await processor.processDocument(file);
      console.log(`Extracted ${docs.length} document chunks`);

      // Update status for question extraction
      console.log("Starting question extraction...");
      processingStatus.set(documentId, {
        currentStep: "questions",
        completedSteps: ["preparation", "extraction"],
        progress: 50
      });

      // Extract questions
      const extractedQuestions = await processor.extractQuestions(docs);
      console.log(`Extracted ${extractedQuestions.length} questions`);
      
      // Update status to analysis
      console.log("Starting analysis...");
      processingStatus.set(documentId, {
        currentStep: "analysis",
        completedSteps: ["preparation", "extraction", "questions"],
        progress: 75
      });

      // Save questions to database
      console.log("Saving questions to database...");
      console.log("Saving questions to database:", extractedQuestions);
      const savedQuestions = await Promise.all(
        extractedQuestions.map(async (q) => {
          console.log("Inserting question:", q);
          const [inserted] = await db.insert(questions).values({
            documentId,
            text: q.text,
            answer: q.answer,
            confidence: q.confidence,
            sourceDocument: q.sourceDocument,
            type: q.type,
            metadata: {}
          }).returning();
          console.log("Successfully inserted question:", inserted);
          return inserted;
        })
      );
      console.log("All questions saved to database:", savedQuestions);

      // Update document status
      await db
        .update(documents)
        .set({ status: "processed" })
        .where(eq(documents.id, documentId));

      // Update final status
      processingStatus.set(documentId, {
        currentStep: "complete",
        completedSteps: ["preparation", "extraction", "questions", "analysis"],
        progress: 100
      });
      
      console.log(`Successfully completed processing document ${documentId}`);
    } catch (error) {
      console.error(`Failed to process document ${documentId}:`, error);
      
      let errorMessage = "An unexpected error occurred";
      if (error instanceof Error) {
        if (error.message.includes("API key")) {
          errorMessage = "OpenAI API authentication failed. Please check the API key configuration.";
        } else if (error.message.includes("quota")) {
          errorMessage = "OpenAI API quota exceeded. Please check your usage limits.";
        } else {
          errorMessage = error.message;
        }
      }

      processingStatus.set(documentId, {
        currentStep: "error",
        completedSteps: [],
        progress: 0,
        error: errorMessage
      });

      await db
        .update(documents)
        .set({ 
          status: "error", 
          metadata: { error: errorMessage } 
        })
        .where(eq(documents.id, documentId));
    }
  } catch (error) {
    console.error(`Failed to process document ${documentId}:`, error);
    if (error instanceof Error) {
      console.error("Error details:", error.message, error.stack);
    }
    throw error;
  }
}