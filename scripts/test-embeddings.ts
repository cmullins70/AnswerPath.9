import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { EmbeddingsService } from '../server/services/embeddings';
import * as schema from '../server/db/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// Load environment variables
config({ path: join(ROOT_DIR, '.env') });

async function testEmbeddings() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required');
    }

    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql, { schema });
    const embeddingsService = new EmbeddingsService();

    // Sample content about a product
    const sampleContent = {
        title: "Enterprise Cloud Storage Solution",
        content: `Our enterprise cloud storage solution offers industry-leading security and scalability. 
        What are the pricing tiers available? We offer three tiers: Basic ($10/user/month), 
        Professional ($25/user/month), and Enterprise (custom pricing).
        How is data encrypted? All data is encrypted at rest using AES-256 encryption and in transit using TLS 1.3.
        What is the maximum storage capacity? The maximum storage capacity varies by tier: Basic (1TB), 
        Professional (5TB), and Enterprise (unlimited).
        Can I integrate with existing systems? Yes, we provide REST APIs and SDKs for major programming languages.
        What kind of support is included? 24/7 support is available for Professional and Enterprise tiers, 
        while Basic tier includes email support during business hours.`,
        type: "knowledge_base"
    };

    try {
        console.log('Creating context...');
        const [context] = await db.insert(schema.contexts)
            .values(sampleContent)
            .returning();
        
        console.log('Context created:', context);

        // Split content into sentences and process
        const sentences = sampleContent.content
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log('\nProcessing sentences...');
        for (const sentence of sentences) {
            if (sentence.includes('?')) {
                console.log('Processing question:', sentence);
                await embeddingsService.storeQuestionEmbedding(context.id, sentence);
            } else {
                console.log('Processing answer:', sentence);
                await embeddingsService.storeAnswerEmbedding(context.id, sentence);
            }
        }

        // Test similarity search
        const testQuery = "How much does it cost?";
        console.log('\nTesting similarity search for:', testQuery);
        const similarQuestions = await embeddingsService.findSimilarQuestions(testQuery);
        console.log('\nSimilar questions found:');
        similarQuestions.forEach((q, i) => {
            console.log(`${i + 1}. Question: "${q.questionText}" (Similarity: ${q.similarity.toFixed(4)})`);
        });

        const testAnswerQuery = "security features";
        console.log('\nTesting similarity search for answers about:', testAnswerQuery);
        const similarAnswers = await embeddingsService.findSimilarAnswers(testAnswerQuery);
        console.log('\nSimilar answers found:');
        similarAnswers.forEach((a, i) => {
            console.log(`${i + 1}. Answer: "${a.answerText}" (Similarity: ${a.similarity.toFixed(4)})`);
        });

    } catch (error) {
        console.error('Error during testing:', error);
    }
}

testEmbeddings().catch(console.error);
