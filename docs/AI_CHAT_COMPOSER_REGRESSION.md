# AI Chat Composer Regression Checks

Use this checklist for Phase 18 verification.

## Smart completion

1. Open chat options.
2. Turn `Smart completion` on.
3. In a chat with an established topic, type:
   - `what about`
   - `latest version`
   - `integration with NodeJS`
   - `fd`
   - `question about`
4. Expected:
   - faint inline ghost completion appears inside the composer after the typed text
   - `Tab` accepts it
   - `Right Arrow` accepts it when the caret is at the end
   - continued typing shrinks, changes, or dismisses the ghost completion
   - nothing is auto-submitted
   - canonical replacements work safely:
     - `fd` -> `FDO`
     - `py` -> `Python`
     - `js` -> `JavaScript`
   - follow-up prompts can pick up the current conversation topic:
     - `question about`
     - `what about`
     - `latest version`

## Smart completion disabled

1. Turn `Smart completion` off.
2. Type the same prompts again.
3. Expected:
   - no inline ghost completion
   - `Tab` behaves normally
   - composer layout remains clean

## Emoji support

1. Click `🙂` in the composer.
2. Insert several emoji.
3. Send:
   - a plain emoji message
   - a reply containing emoji
4. Expected:
   - emoji render correctly in the chat
   - no corruption in reply flow

## Persistence after restart

1. Send a message containing emoji.
2. Restart the app.
3. Reopen the same chat.
4. Expected:
   - emoji are preserved and rendered correctly
   - no schema errors on load

## Streaming sanity

1. Send a prompt that yields a streamed answer.
2. Include emoji in your own preceding message.
3. Expected:
   - streaming remains clean
   - no emoji corruption in existing messages
