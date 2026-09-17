export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('vector length mismatch');
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getMatchThreshold() {
  return parseFloat(process.env.EMBEDDING_MATCH_THRESHOLD || '0.6');
}

export function isMatch(a, b, threshold = getMatchThreshold()) {
  return cosineSimilarity(a, b) >= threshold;
}
