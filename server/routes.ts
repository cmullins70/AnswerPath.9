import type { Express } from "express";
import { createServer } from "http";
import multer from "multer";
import { db } from "@db";
import { documents, questions } from "@db/schema";
import { eq } from "drizzle-orm";

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
  }
});

export function registerRoutes(app: Express) {
  app.post("/api/documents/upload", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const uploadedDocs = await Promise.all(
        files.map(async (file) => {
          return db.insert(documents).values({
            name: file.originalname,
            type: file.mimetype,
            content: file.buffer.toString('base64'),
            status: 'processing',
            metadata: {}
          }).returning();
        })
      );
      res.json(uploadedDocs);
    } catch (error) {
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.get("/api/documents", async (_req, res) => {
    try {
      const docs = await db.select().from(documents);
      res.json(docs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.get("/api/processing/status", async (_req, res) => {
    // Simulated processing status
    res.json({
      currentStep: "extraction",
      completedSteps: [],
      progress: 25
    });
  });

  app.get("/api/questions", async (_req, res) => {
    try {
      const allQuestions = await db.select().from(questions);
      res.json(allQuestions);
    } catch (error) {
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
      res.status(500).json({ error: "Failed to fetch document questions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
