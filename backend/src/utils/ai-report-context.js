'use strict';

const { SECTION_TEXT_LIMIT } = require('./forecast-discussion');

// Removes report text that AI prompts would otherwise pay for twice or that the
// app has already judged irrelevant. It never drops a unique scored value.
const compactReportForAI = (report) => {
  const evidence = report?.supplementalEvidence;
  const discussion = evidence?.discussion;
  if (!discussion || !Array.isArray(discussion.sections) || discussion.sections.length === 0) return report;
  // The parsed sections usually carry the full discussion body, so the raw product
  // text repeats them. A relevant section cut at the parser's limit is incomplete,
  // and then the raw text stays. Aviation and marine sections keep their headings.
  const truncated = discussion.sections.some((section) => (
    section?.kind !== 'not_relevant' && typeof section?.text === 'string' && section.text.length >= SECTION_TEXT_LIMIT
  ));
  const { text, ...rest } = discussion;
  if (truncated && text !== undefined) rest.text = text;
  return {
    ...report,
    supplementalEvidence: {
      ...evidence,
      discussion: {
        ...rest,
        sections: discussion.sections.map((section) => (
          section?.kind === 'not_relevant'
            ? { title: section.title, kind: section.kind, textOmitted: true }
            : section
        )),
      },
    },
  };
};

module.exports = { compactReportForAI };
