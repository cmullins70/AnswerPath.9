import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { vector } from 'pgvector/drizzle-orm';

export const contexts = pgTable('contexts', {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    type: text('type').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

export const questionEmbeddings = pgTable('question_embeddings', {
    id: serial('id').primaryKey(),
    contextId: integer('context_id').notNull().references(() => contexts.id, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

export const answerEmbeddings = pgTable('answer_embeddings', {
    id: serial('id').primaryKey(),
    contextId: integer('context_id').notNull().references(() => contexts.id, { onDelete: 'cascade' }),
    answerText: text('answer_text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});
