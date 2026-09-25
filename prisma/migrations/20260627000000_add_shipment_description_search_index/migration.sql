-- Add tsvector column for full-text search on shipment description
ALTER TABLE shipments 
ADD COLUMN description_search tsvector 
GENERATED ALWAYS AS (to_tsvector('english', coalesce(description, ''))) STORED;

-- Create GIN index on the tsvector column (CONCURRENTLY to avoid locking)
CREATE INDEX CONCURRENTLY shipments_description_search_idx 
ON shipments USING GIN (description_search);
