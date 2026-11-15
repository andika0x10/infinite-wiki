CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  parent_id TEXT REFERENCES topics(id),
  path_json TEXT NOT NULL,
  expanded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE topic_names (
  normalized_name TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id)
);
CREATE TABLE articles (
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  job_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE feed_entries (
  sequence INTEGER PRIMARY KEY CHECK(sequence > 0),
  topic_id TEXT NOT NULL UNIQUE REFERENCES articles(topic_id)
);
CREATE TABLE frontier (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_json TEXT NOT NULL,
  parent_id TEXT NOT NULL REFERENCES topics(id),
  normalized_name TEXT NOT NULL,
  UNIQUE(parent_id, normalized_name)
);
CREATE TABLE semantic_outbox (
  job_key TEXT PRIMARY KEY REFERENCES articles(job_key),
  vectors_json TEXT NOT NULL,
  mutation_id TEXT,
  indexed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON semantic_outbox(indexed);
CREATE TABLE catalog_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  state TEXT NOT NULL CHECK(state IN ('idle', 'pending', 'failed')),
  error_json TEXT
);
INSERT INTO catalog_state(id, state) VALUES (1, 'idle');
INSERT INTO topics(id, title, description, parent_id, path_json)
VALUES ('computer-science', 'Computer science', 'Memahami komputasi, dari gagasan paling dasar hingga sistem yang kita gunakan setiap hari.', NULL, '["Computer science"]');
INSERT INTO topic_names(normalized_name, topic_id) VALUES ('computer science', 'computer-science');
