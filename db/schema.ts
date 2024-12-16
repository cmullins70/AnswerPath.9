import { pgTable, text, serial, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull(),
  metadata: jsonb("metadata"),
});

export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  documentId: serial("document_id").references(() => documents.id),
  text: text("text").notNull(),
  answer: text("answer"),
  confidence: real("confidence"),
  sourceDocument: text("source_document").notNull(),
  type: text("type").notNull(),
  metadata: jsonb("metadata"),
});

export const insertDocumentSchema = createInsertSchema(documents);
export const selectDocumentSchema = createSelectSchema(documents);
export const insertQuestionSchema = createInsertSchema(questions);
export const selectQuestionSchema = createSelectSchema(questions);

export const contexts = pgTable("contexts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull(), // 'knowledge_base', 'website', 'document'
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Context = typeof contexts.$inferSelect;

export const insertContextSchema = createInsertSchema(contexts);
export const selectContextSchema = createSelectSchema(contexts);
