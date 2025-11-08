# AI Coding Agent Integration

## Overview

The AI Coding Agent is a new feature integrated into the FDO built-in code editor. It provides AI-powered coding assistance directly within the editor, leveraging the existing LLM infrastructure (`@themaximalist/llm.js`) and coding assistant configuration.

The AI assistant is **FDO SDK-aware** and can help with plugin development using the `@anikitenko/fdo-sdk`.

## Features

The AI Coding Agent supports four main actions:

1. **Generate Code** - Create new code based on natural language descriptions
2. **Edit Code** - Modify selected code according to instructions
3. **Explain Code** - Get explanations for selected code blocks
4. **Fix Code** - Debug and fix code with error messages

## FDO SDK Integration

The AI Coding Agent has built-in knowledge of the FDO SDK, including:

### Plugin Structure
- Base class: `FDO_SDK`
- Interface: `FDOInterface`
- Required metadata: name, version, author, description, icon
- Lifecycle hooks: `init()`, `render()`

### DOM Element Classes
- **DOMTable**: Tables with full structure support
- **DOMMedia**: Images with accessibility
- **DOMSemantic**: HTML5 semantic elements
- **DOMNested**: Lists and containers
- **DOMInput**: Form inputs and selects
- **DOMText**: Text elements
- **DOMButton**: Interactive buttons
- **DOMLink**: Anchor elements
- **DOMMisc**: Misc elements

### Example SDK Usage

The AI can help you generate plugins like this:

```typescript
import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

export default class MyPlugin extends FDO_SDK implements FDOInterface {
    private readonly _metadata: PluginMetadata = {
        name: "My Plugin",
        version: "1.0.0",
        author: "Your Name",
        description: "Plugin description",
        icon: "COG"
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }

    init(): void {
        this.log("Plugin initialized!");
    }

    render(): string {
        return "<div>Hello World</div>";
    }
}
```

## Architecture

### IPC Channels (`src/ipc/channels.js`)
- Added `AiCodingAgentChannels` with the following operations:
  - `GENERATE_CODE`
  - `EDIT_CODE`
  - `EXPLAIN_CODE`
  - `FIX_CODE`
  - Streaming events: `STREAM_DELTA`, `STREAM_DONE`, `STREAM_ERROR`

### Main Process Handler (`src/ipc/ai_coding_agent.js`)
- Implements handlers for all four AI operations
- Uses the existing coding assistant configuration from settings
- Supports streaming responses for real-time feedback
- Each operation creates a unique request ID for tracking
- **System prompt includes FDO SDK knowledge**

### Preload API (`src/preload.js`)
- Exposes `window.electron.aiCodingAgent` with methods:
  - `generateCode(data)` - Generate new code
  - `editCode(data)` - Edit existing code
  - `explainCode(data)` - Explain code functionality
  - `fixCode(data)` - Fix code errors
  - Event listeners for streaming updates

### UI Component (`src/components/editor/AiCodingAgentPanel.jsx`)
- React component integrated into the Editor page
- Placed as a tab alongside "Problems" and "Output"
- Features:
  - Action selector dropdown
  - Prompt/instruction textarea
  - Real-time streaming response display
  - Insert code into editor button
  - Clear response button
  - Error handling and display

### Editor Integration (`src/components/editor/EditorPage.jsx` and `BuildOutputTerminalComponent.js`)
- AI Coding Agent panel added as a new tab in the bottom panel
- Receives `codeEditor` and `editorModelPath` props for Monaco integration
- Can read selected code, current language, and file context
- Can insert generated/edited code back into the editor

## Configuration

### Prerequisites

1. **Add a Coding Assistant** in Settings:
   - Go to Settings → AI Assistants
   - Add a new assistant with purpose "Coding Assistant"
   - Configure with your preferred provider (OpenAI, Anthropic)
   - Provide API key and select a model (e.g., GPT-4, Claude)
   - Mark as default

## Usage

### In the Editor

1. Open the Plugin Editor (create a new plugin or edit existing)
2. Click on the "AI Coding Agent" tab in the bottom panel (next to Problems and Output)
3. Select an action from the dropdown
4. Based on the action:
   - **Generate Code**: Describe what code you want in the prompt field
   - **Edit Code**: Select code in the editor, then describe the desired changes
   - **Explain Code**: Select code in the editor, optionally add specific questions
   - **Fix Code**: Select problematic code, describe the error in the prompt
5. Click "Submit"
6. Watch the streaming response appear in real-time
7. Click "Insert into Editor" to apply the generated/edited code

### Example Prompts for FDO Plugin Development

**Generate a Plugin:**
```
Create an FDO plugin that displays system metrics (CPU, memory, disk) using the SDK
```

**Edit Code:**
```
Add error handling to this plugin and use the SDK's DOMTable class to display data
```

**Explain Code:**
```
Explain how this plugin uses the FDO_SDK base class and lifecycle hooks
```

**Fix Code:**
```
This plugin fails to render - TypeError: Cannot read property 'render' of undefined
```

### Keyboard Shortcuts

Currently no keyboard shortcuts are assigned, but they can be added in the future for:
- Opening AI Agent tab
- Submitting prompts
- Inserting code

## Testing

### Manual Testing

1. **Test Generate FDO Plugin**:
   - Open editor
   - Go to AI Coding Agent tab
   - Select "Generate Code"
   - Enter: "Create a plugin that shows the current time using FDO SDK"
   - Submit and verify response includes proper SDK usage
   - Insert into editor

2. **Test Edit Code**:
   - Write a basic FDO plugin in the editor
   - Select the code
   - Go to AI Coding Agent tab
   - Select "Edit Code"
   - Enter: "Use DOMTable class to display data in a table"
   - Submit and verify response

3. **Test Explain Code**:
   - Select a plugin code block
   - Go to AI Coding Agent tab
   - Select "Explain Code"
   - Submit and verify explanation mentions SDK concepts

4. **Test Fix Code**:
   - Write plugin code with a deliberate error
   - Select the code
   - Go to AI Coding Agent tab
   - Select "Fix Code"
   - Describe the error
   - Submit and verify fix

### E2E Tests (`tests/e2e/ai-coding-agent.spec.js`)

Automated tests verify:
- AI Coding Agent tab is visible in the bottom panel
- Tab switching works correctly
- Panel components render (action dropdown, prompt textarea, submit button)
- Submit button is disabled when prompt is empty
- Submit button is enabled when prompt is filled
- Action dropdown options can be changed
- NonIdealState displays when no response

**Note**: E2E tests require a display server (Xvfb) in headless environments. Run with:
```bash
xvfb-run npm run test:e2e
```

### Unit Tests

Unit tests can be added for:
- IPC handler logic
- Response streaming
- Code insertion logic
- Error handling

## Future Enhancements

### FDO-Specific Features
1. **Plugin Template Generation**: Quick scaffolding of new plugins
2. **SDK Auto-Import**: Automatically import SDK classes when generating code
3. **Plugin Validation**: Check if generated code follows FDO plugin patterns
4. **Live Preview**: Preview generated plugin UI in real-time
5. **SDK Documentation Lookup**: Quick access to SDK docs while coding

### General Features
6. **Context-Aware Suggestions**: Automatically include file dependencies and project structure
7. **Inline Code Actions**: Add CodeLens or inline buttons for quick AI actions
8. **Chat History**: Maintain conversation context across multiple requests
9. **Custom Prompts**: Allow users to save and reuse common prompts
10. **Multi-file Context**: Analyze and suggest changes across multiple files
11. **Refactoring Assistant**: Automated refactoring suggestions
12. **Code Review**: AI-powered code review comments
13. **Documentation Generation**: Auto-generate JSDoc or other documentation
14. **Test Generation**: Create unit tests for selected code
15. **Performance Optimization**: Suggest performance improvements

## Troubleshooting

### "No AI Coding assistant found" Error
- Ensure you have added a Coding Assistant in Settings
- Verify the assistant is marked as default
- Check that API key is valid

### Streaming Not Working
- Check browser console for errors
- Verify IPC communication is working
- Ensure model supports streaming

### Insert Code Not Working
- Verify code editor is properly mounted
- Check that Monaco editor instance is available
- Look for selection/range issues in console

### Generated Code Doesn't Use SDK
- The AI should automatically use SDK when generating FDO plugins
- If not, explicitly mention "using FDO SDK" in your prompt
- Try regenerating with more specific instructions

## API Reference

### window.electron.aiCodingAgent.generateCode(data)

Generates new code based on a prompt.

**Parameters:**
- `data.prompt` (string): Description of what code to generate
- `data.language` (string): Programming language (auto-detected from editor)
- `data.context` (string): Current file content for context

**Returns:** Promise resolving to `{ success, requestId, content }`

**Example:**
```javascript
await window.electron.aiCodingAgent.generateCode({
  prompt: "Create an FDO plugin that displays weather information",
  language: "typescript",
  context: "// Current file content..."
});
```

### window.electron.aiCodingAgent.editCode(data)

Edits existing code based on instructions.

**Parameters:**
- `data.code` (string): Code to edit
- `data.instruction` (string): How to modify the code
- `data.language` (string): Programming language

**Returns:** Promise resolving to `{ success, requestId, content }`

**Example:**
```javascript
await window.electron.aiCodingAgent.editCode({
  code: selectedCode,
  instruction: "Add error handling using try-catch",
  language: "typescript"
});
```

### window.electron.aiCodingAgent.explainCode(data)

Explains what code does.

**Parameters:**
- `data.code` (string): Code to explain
- `data.language` (string): Programming language

**Returns:** Promise resolving to `{ success, requestId, content }`

**Example:**
```javascript
await window.electron.aiCodingAgent.explainCode({
  code: selectedCode,
  language: "typescript"
});
```

### window.electron.aiCodingAgent.fixCode(data)

Fixes code with errors.

**Parameters:**
- `data.code` (string): Code with errors
- `data.error` (string): Error description
- `data.language` (string): Programming language

**Returns:** Promise resolving to `{ success, requestId, content }`

**Example:**
```javascript
await window.electron.aiCodingAgent.fixCode({
  code: selectedCode,
  error: "TypeError: Cannot read property 'render' of undefined",
  language: "typescript"
});
```

## Implementation Details

### Streaming Response Handling

The AI Coding Agent uses a streaming approach for better UX:

1. User submits a request
2. Backend creates a unique `requestId`
3. Backend starts streaming LLM response
4. Frontend receives `STREAM_DELTA` events with chunks
5. Frontend appends chunks to display
6. Backend sends `STREAM_DONE` when complete
7. Frontend enables "Insert into Editor" button

### Code Insertion

When inserting code:
1. Extracts code from markdown code blocks if present
2. Uses current editor selection as insertion point
3. Pushes edit operation to Monaco editor
4. Maintains undo/redo history
5. Returns focus to editor

### Error Handling

- Network errors displayed as tags with error messages
- Invalid responses handled gracefully
- API key errors caught and displayed
- Streaming interruptions handled with error events

### FDO SDK Knowledge Integration

The AI system prompt includes:
- FDO SDK class structure and patterns
- DOM element generation capabilities
- Plugin lifecycle and metadata requirements
- Common FDO plugin patterns and best practices
- Examples of proper SDK usage

This ensures the AI provides context-aware suggestions that align with FDO development practices.

## Contributing

When adding new features to the AI Coding Agent, consider:

1. **Updating the System Prompt**: Add relevant context about new SDK features
2. **Testing with Real Scenarios**: Validate AI responses against actual plugin development
3. **Error Handling**: Ensure graceful degradation when AI responses are invalid
4. **Performance**: Monitor token usage and response times
5. **User Feedback**: Collect feedback on AI response quality and accuracy

## References

- FDO SDK Repository: https://github.com/anikitenko/fdo-sdk
- FDO Main Repository: https://github.com/anikitenko/fdo
- LLM.js Documentation: https://github.com/themaximalist/llm.js
