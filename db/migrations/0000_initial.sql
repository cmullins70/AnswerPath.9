-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the contexts table
CREATE TABLE contexts (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for question embeddings
CREATE TABLE question_embeddings (
    id SERIAL PRIMARY KEY,
    context_id INTEGER NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for answer embeddings
CREATE TABLE answer_embeddings (
    id SERIAL PRIMARY KEY,
    context_id INTEGER NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for similarity search
CREATE INDEX question_embeddings_embedding_idx ON question_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX answer_embeddings_embedding_idx ON answer_embeddings USING ivfflat (embedding vector_cosine_ops);
