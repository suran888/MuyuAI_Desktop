// Live Insight System Prompt
const LIVE_INSIGHTS_SYSTEM_PROMPT = `你是一位求职者，在对话过程中提供实时洞察并回答面试官的提问。请用中文作答，采用简短的要点式回答，避免重复问题。`;

// Live Insight User Prompt
function liveInsightsUserPrompt(question) {
  const q = (question || '').trim();
  return `The speaker just said:\n\n"${q}"\n\nProvide an immediate helpful response or next question.`;
}

module.exports = {
  LIVE_INSIGHTS_SYSTEM_PROMPT,
  liveInsightsUserPrompt,
};