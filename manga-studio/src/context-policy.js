// Upstream defaults reserve 65,536 tokens, which cannot fit our 32K local model.
export const localCompactionPolicy=Object.freeze({
  auto:true,thresholdRatio:0.8,headroomTokens:2048,retainTokens:2048,
  maxTokens:2048,compactionRetries:1,maxOverflowRetries:1,
});
