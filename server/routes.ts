import type { Express } from "express";
import { createServer } from "http";
import multer from "multer";
import { db } from "@db";
import { documents, questions } from "@db/schema";
import { eq } from "drizzle-orm";
import { DocumentProcessor } from "./services/documentProcessor";

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

  app.get("/api/questions/:documentId", async (req, res) => {
    try {
      const documentQuestions = await db.select()
        .from(questions)
        .where(eq(questions.documentId, parseInt(req.params.documentId)));
      res.json(documentQuestions);
    } catch (error) {
      console.error("Failed to fetch document questions:", error);
      res.status(500).json({ error: "Failed to fetch document questions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function processDocument(documentId: number, file: Express.Multer.File) {
  try {
    console.log(`Starting processing for document ${documentId}`);
    
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
