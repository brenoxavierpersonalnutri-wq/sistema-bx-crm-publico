-- Add renovacao_recusada column to alunas table
ALTER TABLE alunas ADD COLUMN renovacao_recusada BOOLEAN DEFAULT false;
