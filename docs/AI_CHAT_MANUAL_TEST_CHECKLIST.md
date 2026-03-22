# AI Chat Manual Test Checklist

Use this checklist after changes to `src/ipc/ai/` chat behavior.

## Core Chat

- [ ] Create a new chat and send a plain text message.
- [ ] Continue the same chat for at least 3 turns.
- [ ] Verify assistant selection still uses the chosen assistant when multiple assistants share a model.

## Attachments

- [ ] Attach a local image and ask the assistant to describe it.
- [ ] Attach a remote image URL and ask a question about it.
- [ ] Attach a PDF and ask for a summary.
- [ ] Attach another chat session and ask the assistant to use that prior context.

## Tooling

- [ ] Ask a weather question and confirm the weather tool path is used.
- [ ] Ask an FDO-specific help question and confirm `search_fdo_help` is used.
- [ ] Ask an FDO implementation/debug question and confirm `search_fdo_code` is used.
- [ ] Ask a generic programming question and confirm no unnecessary tool is forced.

## Grounding

- [ ] Ask an FDO settings question and verify the answer includes grounded source references.
- [ ] Ask an ambiguous FDO question and verify the assistant either qualifies the answer or asks a follow-up.
- [ ] Ask an FDO question with no obvious local source and verify the assistant does not hallucinate certainty.

## Summarization

- [ ] Force or trigger summarization and verify the summary message appears.
- [ ] Verify token usage updates after compression.
- [ ] Verify the next reply after summarization still follows the real chat topic.

## Stats And Logs

- [ ] Verify request usage logs appear for both streaming and non-streaming responses.
- [ ] Verify active tool selection logs appear when tools are used.
- [ ] Verify retrieval miss logs appear for no-match or ambiguous FDO searches.

## Regression Checks

- [ ] Existing chats still open correctly.
- [ ] Existing assistants still send messages correctly.
- [ ] Anthropic assistant creation still uses the static model list path.
