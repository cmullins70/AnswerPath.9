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
          processDocument(doc.id, file).catch(console.error);

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

  app.get("/api/processing/status", async (req, res) => {
    const documentId = parseInt(req.query.documentId as string);
    const status = processingStatus.get(documentId) || {
      currentStep: "queued",
      completedSteps: [],
      progress: 0
    };
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
    // Update status to extraction
    processingStatus.set(documentId, {
      currentStep: "extraction",
      completedSteps: [],
      progress: 25
    });

    // Process the document
    const docs = await processor.processDocument(file);

    // Update status to questions
    processingStatus.set(documentId, {
      currentStep: "questions",
      completedSteps: ["extraction"],
      progress: 50
    });

    // Extract questions
    const extractedQuestions = await processor.extractQuestions(docs);

    // Save questions to database
    await Promise.all(
      extractedQuestions.map(async (q) => {
        return db.insert(questions).values({
          documentId,
          text: q.text,
          answer: q.answer,
          confidence: q.confidence,
          sourceDocument: q.sourceDocument,
          type: q.type,
          metadata: {}
        });
      })
    );

    // Update document status
    await db
      .update(documents)
      .set({ status: "processed" })
      .where(eq(documents.id, documentId));

    // Update final status
    processingStatus.set(documentId, {
      currentStep: "complete",
      completedSteps: ["extraction", "questions", "analysis", "generation"],
      progress: 100
    });
  } catch (error) {
    console.error(`Failed to process document ${documentId}:`, error);
    processingStatus.set(documentId, {
      currentStep: "error",
      completedSteps: [],
      progress: 0
    });

    await db
      .update(documents)
      .set({ status: "error", metadata: { error: error.message } })
      .where(eq(documents.id, documentId));
  }
}
