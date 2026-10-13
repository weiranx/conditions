// Every configured provider returns text, so structured answers are asked for as
// JSON and read back here. Models sometimes wrap JSON in code fences or tags, or
// leave a trailing comma; anything beyond that is a failed answer, not repaired.
const parseJsonFromAI = (text, { expect = 'object' } = {}) => {
  const source = String(text ?? '');
  const cleaned = source
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<\/?[a-z][\w-]*>/gi, '');
  const [open, close] = expect === 'array' ? ['[', ']'] : ['{', '}'];
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON ${expect} found in AI response: ${source.slice(0, 200)}`);
  }
  const raw = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON from AI: ${error.message}`);
  }
};

module.exports = { parseJsonFromAI };
