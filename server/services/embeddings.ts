import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { db, rawDb } from '../db';
import { questionEmbeddings, answerEmbeddings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';

export class EmbeddingsService {
    private embeddings: OpenAIEmbeddings;

    constructor() {
        this.embeddings = new OpenAIEmbeddings({
            modelName: 'text-embedding-ada-002',
            // Assuming OPENAI_API_KEY is set in environment variables
        });
    }

    async createEmbedding(text: string): Promise<number[]> {
        const embedding = await this.embeddings.embedQuery(text);
        return embedding;
    }

    async storeQuestionEmbedding(contextId: number, questionText: string): Promise<void> {
        const embedding = await this.createEmbedding(questionText);
        await db.insert(questionEmbeddings).values({
            contextId,
            questionText,
            embedding,
        });
    }

    async storeAnswerEmbedding(contextId: number, answerText: string): Promise<void> {
        const embedding = await this.createEmbedding(answerText);
        await db.insert(answerEmbeddings).values({
            contextId,
            answerText,
            embedding,
        });
    }

    async findSimilarQuestions(query: string, limit: number = 5): Promise<Array<{ questionText: string; similarity: number }>> {
        const queryEmbedding = await this.createEmbedding(query);
        
        const result = await rawDb(neon`
            SELECT question_text, 1 - (embedding <=> ${queryEmbedding}::vector) as similarity 
            FROM question_embeddings 
            ORDER BY embedding <=> ${queryEmbedding}::vector 
            LIMIT ${limit}
        `);

        return result.rows.map((row: any) => ({
            questionText: row.question_text,
            similarity: parseFloat(row.similarity),
        }));
    }

    async findSimilarAnswers(query: string, limit: number = 5): Promise<Array<{ answerText: string; similarity: number }>> {
        const queryEmbedding = await this.createEmbedding(query);
        
        const result = await rawDb(neon`
            SELECT answer_text, 1 - (embedding <=> ${queryEmbedding}::vector) as similarity 
            FROM answer_embeddings 
            ORDER BY embedding <=> ${queryEmbedding}::vector 
            LIMIT ${limit}
        `);

        return result.rows.map((row: any) => ({
            answerText: row.answer_text,
            similarity: parseFloat(row.similarity),
        }));
    }

    async deleteContextEmbeddings(contextId: number): Promise<void> {
        await db.delete(questionEmbeddings).where(eq(questionEmbeddings.contextId, contextId));
        await db.delete(answerEmbeddings).where(eq(answerEmbeddings.contextId, contextId));
    }
}
