// OpenAI sends one message per tool result. Gemini requires all responses to
// a parallel function-call turn together in a single user content entry.
export function groupVertexToolResponses(contents) {
  const grouped = [];
  const isResult = content => content?.role === 'user' && content.parts?.some(part => part.functionResponse);
  for (const content of contents) {
    const previous = grouped.at(-1);
    if (isResult(content) && isResult(previous)) {
      previous.parts.push(...content.parts);
    } else {
      grouped.push({ ...content, parts: [...content.parts] });
    }
  }
  return grouped;
}
