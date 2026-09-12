# Margin: personal paper tutor

## Agreed requirements

- Personal education tool for a reader who built a transformer and detected induction heads, but is relatively new to ML, interpretability, and alignment.
- PDFs are the primary reading format. Desktop, phone, and tablet access are first-version requirements. Deployment targets an always-on private server; hosting has not been provisioned.
- Read PDFs with continuous scrolling and select passages across page breaks. Save the selection's start/end pages independently of the current reading position.
- Highlight a passage and explain terminology and omitted reasoning in the context of the paper. Default to concise, conversational replies, usually 2–4 sentences. Save an editable answer length and writing instructions across the library. Offer deeper reasoning and examples on request; fold long answers with a control to reveal the full text.
- Brief scientific/historical orientation, expandable on request. Distinguish contemporary context from later hindsight, and support external claims with sources.
- Recommend prerequisites at an appropriate depth and useful subsequent readings. Explain why each helps. The reader may override every recommendation.
- Persist papers, reading position/status, passage conversations, questions, quiz responses, and learning evidence. Infer understanding cautiously; allow corrections. Reading or highlighting does not prove mastery or ignorance.
- Suggest dismissible quizzes after challenging sections that teach new ideas; allow requesting a quiz anytime. Use transfer questions and feedback, not merely verbatim recall.
- ChatGPT Pro and Claude Max 5x are available. Start with Codex subscription access. Keep the library, conversation history, and learner profile independent of the agent integration. Other integrations may have different authentication and capability constraints.
- Show the active model and reasoning effort beside Reply style. Discover available models and supported effort levels from the connected provider, persist choices across the library, and record the requested model/effort on new replies. Keep accepted requests on their original settings when the reader changes preferences mid-reply.
- Reproduction assistance is explicitly deferred.

## First acceptance case

Paper: https://arxiv.org/abs/2311.03658 (v2).

Passage: “Then, it is natural to take this subspace to be a representation of the concept of Male/Female.”

A useful initial explanation briefly connects repeated matched-pair displacements to a concept direction, defines span{v} when asked, and distinguishes the hypothesis from guaranteed model behavior. Concrete examples and further derivation are available on request. A subsequent quiz varies the example. Follow-up questions, reply style, selected page ranges, and learning evidence survive reload and a second browser session.

## First version boundary

One server process and SQLite storage; responsive React reader; PDF.js display and text selection; Poppler extraction and page images for equation context; a server-side Codex adapter; private-server deployment instructions. All learning data is owned by Margin. The UI does not depend on agent-native conversation identifiers.

## Roadmap

1. Claude and other agent adapters, with supported authentication verified independently.
2. Reproduction plans, implementation exercises, code review, then optional experiment execution.
3. Richer prerequisite ordering and concept relationships; long-term retention review.
4. Scanned-paper OCR, richer figure-region selection, offline reading, and library imports.

## Hosting assumption

The server stays online. Phones/tablets access its authenticated web UI. Provider credentials remain on the server. Use HTTPS and a private network or authenticated reverse proxy; never publish the raw Codex app-server. Browser sessions persist server-side. Mobile browsers may suspend pages, so in-progress tutor work persists independently of the browser request and is recovered by polling.
