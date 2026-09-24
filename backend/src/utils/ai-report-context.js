'use strict';

// Removes report text that AI prompts would otherwise pay for twice or that the
// app has already judged irrelevant. It never drops a unique scored value.
const compactReportForAI = (report) => {
  const evidence = report?.supplementalEvidence;
  const discussion = evidence?.discussion;
  if (!discussion || !Array.isArray(discussion.sections) || discussion.sections.length === 0) return report;
  // The parsed sections carry the full discussion body, so the raw product text
  // repeats them. Aviation and marine sections only keep their headings.
  const { text: _duplicateText, ...rest } = discussion;
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
